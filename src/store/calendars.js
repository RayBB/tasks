/**
 * Nextcloud - Tasks
 *
 * @author Raimund Schlüßler
 * @copyright 2018 Raimund Schlüßler <raimund.schluessler@mailbox.org>
 *
 * @author John Molakvoæ
 * @copyright 2018 John Molakvoæ <skjnldsv@protonmail.com>
 *
 * @author Georg Ehrke
 * @copyright 2018 Georg Ehrke <oc.list@georgehrke.com>
 *
 * @author Thomas Citharel <tcit@tcit.fr>
 * @copyright 2018 Thomas Citharel <tcit@tcit.fr>
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU AFFERO GENERAL PUBLIC LICENSE for more details.
 *
 * You should have received a copy of the GNU Affero General Public
 * License along with this library.  If not, see <http://www.gnu.org/licenses/>.
 *
 */
'use strict'

import parseIcs from '../services/parseIcs.js'
import client from '../services/cdav.js'
import Task from '../models/task.js'
import { isParentInList, searchSubTasks } from './storeHelper.js'
import { findVTODObyState } from './cdav-requests.js'
import router from '../router.js'
import { detectColor, uidToHexColor } from '../utils/color.js'
import { mapCDavObjectToCalendarObject } from '../models/calendarObject'

import ICAL from 'ical.js'
import pLimit from 'p-limit'
import Vue from 'vue'

const calendarModel = {
	id: '',
	color: '',
	displayName: '',
	enabled: true,
	owner: '',
	shares: [],
	tasks: {},
	url: '',
	readOnly: false,
	dav: false,
	supportsEvents: true,
	supportsTasks: true,
	loadedCompleted: false,
	// Whether or not the calendar is shared with me
	isSharedWithMe: false,
	// Whether or not the calendar can be shared by me
	canBeShared: false,
	// The order of this calendar in the calendar-list
	order: 0,
}

const state = {
	calendars: [],
	trashBin: undefined,
	deletedCalendars: [],
	deletedCalendarObjects: [],
}

/**
 * Maps a dav collection to our calendar object model
 *
 * @param {object} calendar The calendar object from the cdav library
 * @param {object} currentUserPrincipal The principal model of the current user principal
 * @returns {object}
 */
export function mapDavCollectionToCalendar(calendar, currentUserPrincipal) {
	const owner = calendar.owner
	let isSharedWithMe = false
	if (!currentUserPrincipal) {
		// If the user is not authenticated, the calendar
		// will always be marked as shared with them
		isSharedWithMe = true
	} else {
		isSharedWithMe = (owner !== currentUserPrincipal.url)
	}
	const displayName = calendar.displayname || getCalendarUriFromUrl(calendar.url)
	// calendar.color can be set to anything on the server,
	// so make sure it's something that remotely looks like a color
	let color = detectColor(calendar.color)
	if (!color) {
		// As fallback if we don't know what color that is supposed to be
		color = uidToHexColor(displayName)
	}

	const shares = []
	if (!!currentUserPrincipal && Array.isArray(calendar.shares)) {
		for (const share of calendar.shares) {
			if (share.href === currentUserPrincipal.principalScheme) {
				continue
			}

			shares.push(mapDavShareeToSharee(share))
		}
	}

	const order = +calendar.order || 0

	return {
		// get last part of url
		id: calendar.url.split('/').slice(-2, -1)[0],
		displayName,
		color,
		order,
		enabled: calendar.enabled !== false,
		owner,
		readOnly: !calendar.isWriteable(),
		tasks: {},
		url: calendar.url,
		dav: calendar,
		shares,
		supportsEvents: calendar.components.includes('VEVENT'),
		supportsTasks: calendar.components.includes('VTODO'),
		loadedCompleted: false,
		isSharedWithMe,
		canBeShared: calendar.isShareable(),
	}
}

/**
 * Maps a dav collection to the sharee array
 *
 * @param {object} sharee The sharee object from the cdav library shares
 * @returns {object}
 */
export function mapDavShareeToSharee(sharee) {
	const id = sharee.href.split('/').slice(-1)[0]
	let name = sharee['common-name']
		? sharee['common-name']
		: sharee.href

	if (sharee.href.startsWith('principal:principals/groups/') && name === sharee.href) {
		name = sharee.href.substr(28)
	}

	return {
		displayName: name,
		id,
		writeable: sharee.access[0].endsWith('read-write'),
		isGroup: sharee.href.startsWith('principal:principals/groups/'),
		isCircle: sharee.href.startsWith('principal:principals/circles/'),
		uri: sharee.href,
	}
}

/**
 * Gets the calendar uri from the url
 *
 * @param {string} url The url to get calendar uri from
 * @returns {string}
 */
function getCalendarUriFromUrl(url) {
	if (url.endsWith('/')) {
		url = url.substring(0, url.length - 1)
	}

	return url.substring(url.lastIndexOf('/') + 1)
}

const getters = {

	/**
	 * Returns the calendars sorted alphabetically
	 *
	 * @param {object} state The store data
	 * @returns {Array<Calendar>} Array of the calendars sorted alphabetically
	 */
	getSortedCalendars: state => {
		return state.calendars.sort(function(cal1, cal2) {
			const n1 = cal1.order
			const n2 = cal2.order
			return (n1 < n2) ? -1 : (n1 > n2) ? 1 : 0
		})
	},

	/**
	 * Returns the calendars sorted alphabetically
	 *
	 * @param {object} state The store data
	 * @returns {Array<Calendar>} Array of the calendars sorted alphabetically
	 */
	getSortedWritableCalendars: state => {
		return state.calendars.filter(calendar => {
			return !calendar.readOnly
		})
			.sort(function(cal1, cal2) {
				const n1 = cal1.order
				const n2 = cal2.order
				return (n1 < n2) ? -1 : (n1 > n2) ? 1 : 0
			})
	},

	/**
	 * Returns the calendar with the given calendarId
	 *
	 * @param {object} state The store data
	 * @param {string} calendarId The id of the requested calendar
	 * @returns {Calendar} The requested calendar
	 */
	getCalendarById: state => (calendarId) => {
		const calendar = state.calendars.find(search => search.id === calendarId)
		return calendar
	},

	/**
	 * Returns the number of tasks in a calendar
	 *
	 * Tasks have to be
	 * - a root task
	 * - uncompleted
	 *
	 * @param {object} state The store data
	 * @param {object} getters The store getters
	 * @param {object} rootState The store root state
	 * @param {string} calendarId The id of the requested calendar
	 * @returns {Integer} The number of tasks
	 */
	getCalendarCount: (state, getters, rootState) => (calendarId) => {
		const calendar = getters.getCalendarById(calendarId)
		let tasks = Object.values(calendar.tasks)
			.filter(task => {
				return task.closed === false && (!task.related || !isParentInList(task, calendar.tasks))
			})
		if (rootState.tasks.searchQuery) {
			tasks = tasks.filter(task => {
				if (task.matches(rootState.tasks.searchQuery)) {
					return true
				}
				// We also have to show tasks for which one sub(sub...)task matches.
				return searchSubTasks(task, rootState.tasks.searchQuery)
			})
		}
		return tasks.length
	},

	/**
	 * Returns the count of closed tasks in a calendar
	 *
	 * Tasks have to be
	 * - a root task
	 * - closed
	 *
	 * @param {object} state The store data
	 * @param {object} getters The store getters
	 * @param {string} calendarId The id of the calendar in question
	 * @returns {Integer} The count of closed tasks in a calendar
	 */
	getCalendarCountClosed: (state, getters) => (calendarId) => {
		const calendar = getters.getCalendarById(calendarId)
		return Object.values(calendar.tasks)
			.filter(task => {
				return task.closed === true && (!task.related || !isParentInList(task, calendar.tasks))
			}).length
	},

	/**
	 * Returns if a calendar name is already used by an other calendar
	 *
	 * @param {object} state The store data
	 * @param {string} name The name to check
	 * @param {string} id The id of the calendar to exclude
	 * @returns {boolean} If a calendar name is already used
	 */
	isCalendarNameUsed: state => (name, id) => {
		return state.calendars.some(calendar => {
			return (calendar.displayName === name && calendar.id !== id)
		})
	},

	/**
	 * Returns the current calendar
	 *
	 * @param {object} state The store data
	 * @param {object} getters The store getters
	 * @param {object} rootState The store root state
	 * @returns {Calendar} The calendar by route
	 */
	getCalendarByRoute: (state, getters, rootState) => {
		if (rootState.route.params.collectionId) {
			return getters.getDefaultCalendar
		}
		return getters.getCalendarById(rootState.route.params.calendarId)
	},

	/**
	 * Returns the default calendar
	 *
	 * @param {object} state The store data
	 * @param {object} getters The store getters
	 * @param {object} rootState The store root state
	 * @returns {Calendar} The default calendar
	 */
	getDefaultCalendar: (state, getters, rootState) => {
		const defaultCalendar = getters.getCalendarById(rootState.settings.settings.defaultCalendarId)
		// If the default calendar is read only we return the first calendar that is writable
		if (!defaultCalendar || defaultCalendar.readOnly) {
			return getters.getSortedCalendars.find(calendar => !calendar.readOnly) || getters.getSortedCalendars[0]
		}
		return defaultCalendar
	},

	hasTrashBin: (state) => {
		return state.trashBin !== undefined && state.trashBin.retentionDuration !== 0
	},

	trashBin: (state) => {
		return state.trashBin
	},

	/**
	 * List of deleted sorted calendars
	 *
	 * @param {object} state the store data
	 * @returns {Array}
	 */
	sortedDeletedCalendars(state) {
		return state.deletedCalendars
			.sort((a, b) => a.deletedAt - b.deletedAt)
	},

	/**
	 * List of deleted calendars objects
	 *
	 * @param {object} state the store data
	 * @returns {Array}
	 */
	deletedCalendarObjects(state) {
		const calendarUriMap = {}
		state.calendars.forEach(calendar => {
			const withoutTrail = calendar.url.replace(/\/$/, '')
			const uri = withoutTrail.substr(withoutTrail.lastIndexOf('/') + 1)
			calendarUriMap[uri] = calendar
		})

		return state.deletedCalendarObjects.map(obj => ({
			calendar: calendarUriMap[obj.dav._props['{http://nextcloud.com/ns}calendar-uri']],
			...obj,
		}))
	},
}

const mutations = {

	/**
	 * Adds a calendar to the state
	 *
	 * @param {object} state The store data
	 * @param {Calendar} calendar The calendar to add
	 */
	addCalendar(state, calendar) {
		// extend the calendar to the default model
		calendar = Object.assign({}, calendarModel, calendar)
		// Only add the calendar if it is not already present
		if (state.calendars.some(cal => {
			return cal.id === calendar.id
		})) {
			return
		}
		state.calendars.push(calendar)
	},

	/**
	 * Delete calendar
	 *
	 * @param {object} state The store data
	 * @param {Calendar} calendar The calendar to delete
	 */
	deleteCalendar(state, calendar) {
		state.calendars.splice(state.calendars.indexOf(calendar), 1)
	},

	addTrashBin(state, { trashBin }) {
		state.trashBin = trashBin
	},

	/**
	 * Adds deleted calendar into state
	 *
	 * @param {object} state the store data
	 * @param {object} data destructuring object
	 * @param {object} data.calendar calendar the calendar to add
	 */
	addDeletedCalendar(state, { calendar }) {
		if (state.deletedCalendars.some(c => c.url === calendar.url)) {
			// This calendar is already known
			return
		}
		state.deletedCalendars.push(calendar)
	},

	/**
	 * Removes a deleted calendar
	 *
	 * @param {object} state the store data
	 * @param {object} data destructuring object
	 * @param {object} data.calendar the deleted calendar to remove
	 */
	removeDeletedCalendar(state, { calendar }) {
		state.deletedCalendars = state.deletedCalendars.filter(c => c !== calendar)
	},

	/**
	 * Removes a deleted calendar object
	 *
	 * @param {object} state the store data
	 * @param {object} data destructuring object
	 * @param {object} data.vobject the deleted calendar object to remove
	 */
	removeDeletedCalendarObject(state, { vobject }) {
		state.deletedCalendarObjects = state.deletedCalendarObjects.filter(vo => vo.id !== vobject.id)
	},

	/**
	 * Adds a deleted vobject into state
	 *
	 * @param {object} state the store data
	 * @param {object} data destructuring object
	 * @param {object} data.vobject the calendar vobject to add
	 */
	addDeletedCalendarObject(state, { vobject }) {
		if (state.deletedCalendarObjects.some(c => c.uri === vobject.uri)) {
			// This vobject is already known
			return
		}
		state.deletedCalendarObjects.push(vobject)
	},

	/**
	 * Toggles whether a calendar is enabled
	 *
	 * @param {object} context The store mutations
	 * @param {Calendar} calendar The calendar to toggle
	 */
	toggleCalendarEnabled(context, calendar) {
		calendar.enabled = !calendar.enabled
	},

	/**
	 * Changes the name and the color of a calendar
	 *
	 * @param {object} context The store mutations
	 * @param {object} data Destructuring object
	 * @param {Calendar} data.calendar The calendar to change
	 * @param {string} data.newName The new name of the calendar
	 * @param {string} data.newColor The new color of the calendar
	 */
	renameCalendar(context, { calendar, newName, newColor }) {
		calendar.displayName = newName
		calendar.color = newColor
	},

	/**
	 * Appends a list of tasks to a calendar
	 * and removes duplicates
	 *
	 * @param {object} state The store data
	 * @param {object} data Destructuring object
	 * @param {Calendar} data.calendar The calendar to add the tasks to
	 * @param {Task[]} data.tasks Array of tasks to append
	 */
	appendTasksToCalendar(state, { calendar, tasks }) {
		// Convert list into an array and remove duplicate
		calendar.tasks = tasks.reduce((list, task) => {
			if (list[task.uid]) {
				console.debug('Duplicate task overridden', list[task.uid], task)
			}
			Vue.set(list, task.uid, task)
			return list
		}, calendar.tasks)

	},

	/**
	 * Adds a task to a calendar and overwrites if duplicate uid
	 *
	 * @param {object} state The store data
	 * @param {Task} task The task to add
	 */
	addTaskToCalendar(state, task) {
		Vue.set(task.calendar.tasks, task.uid, task)
	},

	/**
	 * Deletes a task from its calendar
	 *
	 * @param {object} state The store data
	 * @param {Task} task The task to delete
	 */
	deleteTaskFromCalendar(state, task) {
		Vue.delete(task.calendar.tasks, task.uid)
	},

	/**
	 * Shares a calendar with a user or group
	 *
	 * @param {object} state The store data
	 * @param {object} data Destructuring object
	 * @param {Calendar} data.calendar The calendar
	 * @param {string} data.user The userId
	 * @param {string} data.displayName The displayName
	 * @param {string} data.uri The sharing principalScheme uri
	 * @param {boolean} data.isGroup Is this a group ?
	 * @param {boolean} data.isCircle Is this a circle?
	 */
	shareCalendar(state, { calendar, user, displayName, uri, isGroup, isCircle }) {
		calendar = state.calendars.find(search => search.id === calendar.id)
		const newSharee = {
			displayName,
			id: user,
			writeable: false,
			isGroup,
			isCircle,
			uri,
		}
		if (!calendar.shares.some((share) => share.uri === uri)) {
			calendar.shares.push(newSharee)
		}
	},

	/**
	 * Removes a sharee from calendar shares list
	 *
	 * @param {object} state The store data
	 * @param {object} data Destructuring object
	 * @param {Calendar} data.calendar The calendar
	 * @param {string} data.uri The sharee uri
	 */
	removeSharee(state, { calendar, uri }) {
		calendar = state.calendars.find(search => search.id === calendar.id)
		const shareIndex = calendar.shares.findIndex(sharee => sharee.uri === uri)
		calendar.shares.splice(shareIndex, 1)
	},

	/**
	 * Toggles sharee's writable permission
	 *
	 * @param {object} state The store data
	 * @param {object} data Destructuring object
	 * @param {object} data.calendar The calendar
	 * @param {string} data.uri The sharee uri
	 */
	updateShareeWritable(state, { calendar, uri }) {
		calendar = state.calendars.find(search => search.id === calendar.id)
		const sharee = calendar.shares.find(sharee => sharee.uri === uri)
		sharee.writeable = !sharee.writeable
	},

	/**
	 * Sets the sort order of a calendar
	 *
	 * @param {object} state The store data
	 * @param {Calendar} calendar The calendar
	 * @param {Integer} order The sort order
	 */
	setCalendarOrder(state, { calendar, order }) {
		Vue.set(calendar, 'order', order)
	},
}

const actions = {
	/**
	 * Retrieves and commits calendars
	 *
	 * @param {object} context The store mutations
	 * @returns {Promise<Array>} The calendars
	 */
	async getCalendarsAndTrashBin({ commit, state, getters }) {
		let { calendars, trashBins } = await client.calendarHomes[0].findAllCalDAVCollectionsGrouped()
		calendars = calendars.map(calendar => {
			return mapDavCollectionToCalendar(calendar, getters.getCurrentUserPrincipal)
		})

		// Remove calendars which don't support tasks
		calendars = calendars.filter(calendar => calendar.supportsTasks)

		calendars.forEach(calendar => {
			commit('addCalendar', calendar)
		})

		if (trashBins.length) {
			commit('addTrashBin', { trashBin: trashBins[0] })
		}

		return {
			calendars: state.calendars,
			trashBin: state.trashBin,
		}
	},

	/**
	 * Retrieve and commit deleted calendars
	 *
	 * @param {object} context the store mutations
	 * @returns {Promise<Array>} the calendars
	 */
	async loadDeletedCalendars({ commit }) {
		const calendars = await client.calendarHomes[0].findAllDeletedCalendars()

		calendars.forEach(calendar => commit('addDeletedCalendar', { calendar }))
	},

	/**
	 * Retrieve and commit deleted calendar objects
	 */
	async loadDeletedCalendarObjects({ commit, state }) {
		const vobjects = await state.trashBin.findDeletedObjects()
		console.info('vobjects loaded', { vobjects })

		vobjects.forEach(vobject => {
			try {
				const calendarObject = mapCDavObjectToCalendarObject(vobject, undefined)
				commit('addDeletedCalendarObject', { vobject: calendarObject })
			} catch (error) {
				console.error('could not convert calendar object', vobject, error)
			}
		})
	},

	/**
	 * Appends a new calendar to array of existing calendars
	 *
	 * @param {object} context The store mutations
	 * @param {Calendar} calendar The calendar to append
	 * @returns {Promise}
	 */
	async appendCalendar(context, calendar) {
		return client.calendarHomes[0].createCalendarCollection(calendar.displayName, calendar.color, ['VTODO'])
			.then((response) => {
				calendar = mapDavCollectionToCalendar(response, context.getters.getCurrentUserPrincipal)
				context.commit('addCalendar', calendar)
				// Open the calendar
				router.push({ name: 'calendars', params: { calendarId: calendar.id } })
			})
			.catch((error) => { throw error })
	},

	/**
	 * Delete calendar
	 *
	 * @param {object} context The store mutations Current context
	 * @param {Calendar} calendar The calendar to delete
	 * @returns {Promise}
	 */
	async deleteCalendar(context, calendar) {
		return calendar.dav.delete()
			.then((response) => {
				// Delete all the tasks from the store that belong to this calendar
				Object.values(calendar.tasks)
					.forEach(task => context.commit('deleteTask', task))
				// Then delete the calendar
				context.commit('deleteCalendar', calendar)
			})
			.catch((error) => { throw error })
	},

	/**
	 * Delete a calendar in the trash bin
	 *
	 * @param {object} context the store mutations Current context
	 * @param {object} data destructuring object
	 * @param {object} data.calendar the calendar to delete
	 * @returns {Promise}
	 */
	async deleteCalendarPermanently(context, { calendar }) {
		await calendar.delete({
			'X-NC-CalDAV-No-Trashbin': 1,
		})

		context.commit('removeDeletedCalendar', { calendar })
	},

	async restoreCalendar({ commit, state }, { calendar }) {
		await state.trashBin.restore(calendar.url)

		commit('removeDeletedCalendar', { calendar })
	},

	async restoreCalendarObject({ commit, state, dispatch }, { vobject }) {
		await state.trashBin.restore(vobject.uri)

		// Clean up the data locally
		commit('removeDeletedCalendarObject', { vobject })

		// It would be more elegant to only add the restored task
		if (vobject.isTodo) {
			dispatch('getTasksFromCalendar', { calendar: vobject.calendar })
		}
	},

	/**
	 * Deletes a calendar-object permanently
	 *
	 * @param {object} context the store mutations
	 * @param {object} data destructuring object
	 * @param {vobject} data.vobject Calendar-object to delete
	 * @returns {Promise<void>}
	 */
	async deleteCalendarObjectPermanently(context, { vobject }) {
		await vobject.dav.delete({
			'X-NC-CalDAV-No-Trashbin': 1,
		})

		context.commit('removeDeletedCalendarObject', { vobject })
	},

	/**
	 * Toggles whether a calendar is enabled
	 *
	 * @param {object} context The store mutations current context
	 * @param {Calendar} calendar The calendar to toggle
	 * @returns {Promise}
	 */
	async toggleCalendarEnabled(context, calendar) {
		calendar.dav.enabled = !calendar.dav.enabled
		return calendar.dav.update()
			.then((response) => context.commit('toggleCalendarEnabled', calendar))
			.catch((error) => { throw error })
	},

	/**
	 * Changes the name and the color of a calendar
	 *
	 * @param {object} context The store mutations Current context
	 * @param {Calendar} data.calendar The calendar to change
	 * @param {string} data.newName The new name of the calendar
	 * @param {string} data.newColor The new color of the calendar
	 * @returns {Promise}
	 */
	async changeCalendar(context, { calendar, newName, newColor }) {
		calendar.dav.displayname = newName
		calendar.dav.color = newColor
		return calendar.dav.update()
			.then((response) => context.commit('renameCalendar', { calendar, newName, newColor }))
			.catch((error) => { throw error })
	},

	/**
	 * Retrieves the tasks of the specified calendar
	 * and commits the results
	 *
	 * @param {object} context The store mutations
	 * @param {object} data Destructuring object
	 * @param {Calendar} data.calendar The calendar
	 * @param {string} data.completed Are the requested tasks completed
	 * @param {string} data.related The uid of the parent task
	 * @returns {Promise}
	 */
	async getTasksFromCalendar(context, { calendar, completed = false, related = null }) {
		try {
			const response = await findVTODObyState(calendar, completed, related)
			if (response) {
				// If we loaded completed tasks, note that.
				if (completed) {
					calendar.loadedCompleted = true
				}
				// We don't want to lose the url information
				// so we need to parse one by one
				const tasks = response.map(item => {
					const task = new Task(item.data, calendar)
					Vue.set(task, 'dav', item)
					return task
				})

				// Initialize subtasks so we don't have to search for them on every change.
				// We do have to manually adjust this list when a task is added, deleted or moved.
				tasks.forEach(
					parent => {
						const subTasks = tasks.filter(task => {
							return task.related === parent.uid
						})

						// Convert list into an array and remove duplicate
						parent.subTasks = subTasks.reduce((list, task) => {
							if (list[task.uid]) {
								console.debug('Duplicate task overridden', list[task.uid], task)
							}
							Vue.set(list, task.uid, task)
							return list
						}, parent.subTasks)

						// In case we already have subtasks of this task in the store, add them as well.
						const subTasksInStore = context.getters.getTasksByParent(parent)
						subTasksInStore.forEach(
							subTask => {
								context.commit('addTaskToParent', { task: subTask, parent })
							}
						)

						// If necessary, add the tasks as subtasks to parent tasks already present in the store.
						if (!related) {
							const parentParent = context.getters.getTaskByUid(parent.related)
							context.commit('addTaskToParent', { task: parent, parent: parentParent })
						}
					}
				)

				// If the requested tasks are related to a task, add the tasks as subtasks
				if (related) {
					const parent = Object.values(calendar.tasks).find(search => search.uid === related)
					if (parent) {
						parent.loadedCompleted = true
						tasks.map(task => Vue.set(parent.subTasks, task.uid, task))
					}
				}

				context.commit('appendTasksToCalendar', { calendar, tasks })
				context.commit('appendTasks', tasks)
				return tasks
			}
		} catch (error) {
			// unrecoverable error, if no tasks were loaded,
			// remove the calendar
			// TODO: create a failed calendar state and show that there was an issue?
			context.commit('deleteCalendar', calendar)
			console.error(error)
		}
	},

	/**
	 * Imports tasks into a calendar from an ics file
	 *
	 * @param {object} context The store mutations
	 * @param {object} importDetails = { ics, calendar }
	 */
	async importTasksIntoCalendar(context, { ics, calendar }) {
		const tasks = parseIcs(ics, calendar)
		context.commit('changeStage', 'importing')

		// max simultaneous requests
		const limit = pLimit(3)
		const requests = []

		// create the array of requests to send
		tasks.map(async task => {
			// Get vcard string
			try {
				const vData = ICAL.stringify(task.vCard.jCal)
				// push task to server and use limit
				requests.push(limit(() => task.calendar.dav.createVCard(vData)
					.then((response) => {
						// setting the task dav property
						Vue.set(task, 'dav', response)

						// success, update store
						context.commit('addTask', task)
						context.commit('addTaskToCalendar', task)
						context.commit('incrementAccepted')
					})
					.catch((error) => {
						// error
						context.commit('incrementDenied')
						console.error(error)
					})
				))
			} catch (e) {
				context.commit('incrementDenied')
			}
		})

		Promise.all(requests).then(() => {
			context.commit('changeStage', 'default')
		})
	},

	/**
	 * Removes a sharee from a calendar
	 *
	 * @param {object} context The store mutations Current context
	 * @param {object} data Destructuring object
	 * @param {object} data.calendar The calendar
	 * @param {string} data.uri The sharee uri
	 */
	async removeSharee(context, { calendar, uri }) {
		await calendar.dav.unshare(uri)
		context.commit('removeSharee', { calendar, uri })
	},

	/**
	 * Toggles permissions of calendar sharees writeable rights
	 *
	 * @param {object} context The store mutations Current context
	 * @param {object} data Destructuring object
	 * @param {object} data.calendar The calendar
	 * @param {string} data.uri The sharee uri
	 * @param {boolean} data.writeable The sharee permission
	 */
	async toggleShareeWritable(context, { calendar, uri, writeable }) {
		await calendar.dav.share(uri, writeable)
		context.commit('updateShareeWritable', { calendar, uri, writeable })
	},

	/**
	 * Shares a calendar with a user or a group
	 *
	 * @param {object} context The store mutations Current context
	 * @param {Calendar} data.calendar The calendar
	 * @param {string} data.user The userId
	 * @param {string} data.displayName The displayName
	 * @param {string} data.uri The sharing principalScheme uri
	 * @param {boolean} data.isGroup Is this a group ?
	 * @param {boolean} data.isCircle Is this a circle?
	 */
	async shareCalendar(context, { calendar, user, displayName, uri, isGroup, isCircle }) {
		// Share calendar with entered group or user
		await calendar.dav.share(uri)
		context.commit('shareCalendar', { calendar, user, displayName, uri, isGroup, isCircle })
	},

	/**
	 * Sets the sort order of a calendar
	 *
	 * @param {object} context The store context
	 * @param {Calendar} calendar The calendar to update
	 * @param {Integer} order The sort order
	 */
	async setCalendarOrder(context, { calendar, order }) {
		if (calendar.order === order) {
			return
		}

		context.commit('setCalendarOrder', { calendar, order })
		calendar.dav.order = order
		await calendar.dav.update()
	},
}

export default { state, getters, mutations, actions }
