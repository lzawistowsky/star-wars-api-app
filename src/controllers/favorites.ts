import { RequestHandler } from "express"
// import { HydratedDocument } from 'mongoose';
import fetch from "node-fetch"
import HttpException from "../exceptions/HttpException"
import { Like } from "typeorm"
// import { Types } from "mongoose"
import ExcelJS from 'exceljs'

import { AppDataSource } from '../data-sorce'
import { Film } from "../models/film"
import { List } from "../models/list"
import { Character } from "../models/character"

const filmRepository = AppDataSource.getRepository(Film)
const characterRepository = AppDataSource.getRepository(Character)
const listRepository = AppDataSource.getRepository(List)

type PostFavoritesBody = { listName: string, films: number[] }
type GetFavoritesQuery = { search: string, page: number, limit: number }
type GetListParams = { id: number }

export const postFavorites: RequestHandler = async (req, res, next) => {
    try {
        const body = req.body as PostFavoritesBody
        const listName = body.listName
        const films = body.films

        let filmsList: Array<Film> = []
        for (const film of films) {
            const externalData = await fetch(`https://swapi.dev/api/films/${film}`)
            const result = await externalData.json()

            if(!result) {
                const error = new HttpException(404, 'film not found')
                throw error
            }

            const exsistingFilm = await filmRepository.findOneBy({ title: result.title })
            if(!exsistingFilm) {
                let characterList: Array<Character> = []
                for (const character of result.characters) {
                    const fetchCharacter = await fetch(character)
                    const rawCharacter = await fetchCharacter.json()

                    const existingCharacter = await characterRepository.findOneBy({name: rawCharacter.name})
                    if(!existingCharacter) {
                        const newCharacter = new Character()
                        newCharacter.name = rawCharacter.name
                        await characterRepository.save(newCharacter)
                        
                        characterList.push(newCharacter)
                    } else {
                        characterList.push(existingCharacter)
                    }
                }

                const newFilm = new Film()
                newFilm.title = result.title,
                newFilm.releaseDate = result.release_date,
                newFilm.characters = characterList
                await filmRepository.save(newFilm)

                filmsList.push(newFilm)
            } else {
                filmsList.push(exsistingFilm)
            }
        }

        const list = new List()
        list.listName = listName
        list.films = filmsList
        const newList = await listRepository.save(list)

        res.status(201).json({
            list: newList
        })
    } catch (e) {
        next(e)
    }
}

export const getFavorites: RequestHandler = async (req, res, next) => {
    try {
        const query = req.query as unknown as GetFavoritesQuery
        const search = query.search
        const page = query.page || 1
        const limit = query.limit || 10

        let filter = {}
        if (search) filter = { 
            listName: Like(`%${search}%`)
        }

        const lists = await listRepository.find({
            where: filter,
            take: limit,
            skip: limit * ( page - 1 )
        })

        if(!lists) {
            const error = new HttpException(404, 'list not found')
            throw error
        }

        const mappedList = lists.map(list => {
            return {
                id: list.id,
                name: list.listName
            }
        })
        
        res.status(200).json({
            lists: mappedList
        })
    } catch (e) {
        next(e)
    }
}

export const getList: RequestHandler = async (req, res, next) => {
    try {
        const params = req.params as unknown as GetListParams
        const id = params.id

        const list = await listRepository.findOne({
            where: {
                id: id
            },
            relations: ['films', 'films.characters']
        })
        if(!list) {
            const error = new HttpException(404, 'list with selected id not found')
            throw error
        }

        res.status(200).json({
            list: list
        })
    } catch (e) {
        next(e)
    }
}

export const getListFile: RequestHandler = async (req, res, next) => {
    try {
        const params = req.params as unknown as GetListParams
        const id = params.id

        const list = await listRepository.findOne({
            where: { 
                id: id 
            },
            relations: ['films', 'films.characters']

        })
        if(!list) {
            const error = new HttpException(404, 'list with selected id not found')
            throw error
        }

        let tableName: string[] = []
        let tableMovies: string[] = []

        for (const film of list.films) {
            for(const character of film.characters) {
                const hero = await characterRepository.findOneBy({ id: character.id })
                const name = (hero as Character).name 
                if(!tableName.includes(name)) {
                    tableName.push(name)
                    tableMovies.push(film.title)
                } else {
                    tableMovies[tableName.indexOf(name)] += ", " + film.title
                }
            }
        }

        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('list details')

        sheet.columns = [
            { header: 'Character', key: 'character'},
            { header: 'Movies', key: 'movies'}
        ]

        for (let i = 0; i < tableMovies.length; i++) sheet.addRow({character: tableName[i], movies: tableMovies[i]});
        
        const filename: string = Date.now() + 'data.xlsx'
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        res.setHeader("Content-Disposition", "attachment; filename=" + filename)

        await workbook.xlsx.write(res)
        res.end()
        
    } catch (e) {
        next(e)
    }
}