<!--
Nextcloud - Tasks

@author Raimund Schlüßler
@copyright 2018 Raimund Schlüßler <raimund.schluessler@mailbox.org>

This library is free software; you can redistribute it and/or
modify it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE
License as published by the Free Software Foundation; either
version 3 of the License, or any later version.

This library is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU AFFERO GENERAL PUBLIC LICENSE for more details.

You should have received a copy of the GNU Affero General Public
License along with this library. If not, see <http://www.gnu.org/licenses/>.

-->

<template>
	<AppNavigationItem :id="'list_' + calendar.id"
		v-click-outside="{ handler: resetView, middleware: clickOutsideMiddleware }"
		:calendar-id="calendar.id"
		:to="{ name: 'calendars', params: { calendarId: calendar.id } }"
		:title="calendar.displayName"
		:class="{'list--edit': editing, 'list--deleted': !!deleteTimeout}"
		class="list reactive"
		@drop.native="dropTask"
		@dragover.native="dragOver"
		@dragenter.native="dragEnter"
		@dragleave.native="dragLeave">
		<template #icon>
			<AppNavigationIconBullet :color="calendar.color" />
		</template>

		<template v-if="!deleteTimeout" #counter>
			<Actions v-if="calendar.canBeShared"
				:class="{shared: hasShares}"
				class="sharing">
				<ActionButton @click="toggleShare">
					<template #icon>
						<ShareVariant :size="20" />
					</template>
					{{ sharedWithTooltip }}
				</ActionButton>
			</Actions>
			<Avatar v-if="calendar.isSharedWithMe && loadedOwnerPrincipal" :user="ownerUserId" :display-name="ownerDisplayname" />
			<div v-if="calendar.isSharedWithMe && !loadedOwnerPrincipal" class="icon icon-loading" />
			<AppNavigationCounter v-if="calendarCount">
				{{ counterFormatter(calendarCount) }}
			</AppNavigationCounter>
		</template>

		<template v-if="!deleteTimeout" #actions>
			<ActionButton v-if="!calendar.readOnly"
				class="edit-calendar"
				:close-after-click="true"
				@click="editCalendar">
				<template #icon>
					<Pencil :size="20" />
				</template>
				{{ t('tasks', 'Edit') }}
			</ActionButton>
			<ActionButton :close-after-click="true"
				@click="copyCalDAVUrl($event, calendar)">
				<template #icon>
					<LinkVariant :size="20" />
				</template>
				{{ !copied
					? t('tasks', 'Copy private link')
					: copySuccess
						? t('tasks', 'Copied')
						: t('tasks', 'Cannot copy') }}
			</ActionButton>
			<ActionLink :close-after-click="true"
				:href="exportUrl">
				<template #icon>
					<Download :size="20" />
				</template>
				{{ t('tasks', 'Export') }}
			</ActionLink>
			<ActionButton v-if="!calendar.readOnly || calendar.isSharedWithMe"
				v-tooltip="{
					placement: 'left',
					boundariesElement: 'body',
					content: deleteMessage
				}"
				@click="scheduleDelete">
				<template v-if="!calendar.isSharedWithMe" #icon>
					<Delete :size="20" />
				</template>
				<template v-else #icon>
					<Close :size="20" />
				</template>
				{{ !calendar.isSharedWithMe ? t('tasks', 'Delete') : t('tasks', 'Unshare') }}
			</ActionButton>
		</template>

		<template v-else #actions>
			<ActionButton @click.prevent.stop="cancelDelete">
				<template #icon>
					<Undo :size="20" />
				</template>
				{{ undoDeleteMessage }}
			</ActionButton>
		</template>

		<li>
			<ShareCalendar v-if="shareOpen && !calendar.readOnly && !deleteTimeout" :calendar="calendar" />
			<div v-if="!deleteTimeout" :class="{error: nameError}" class="app-navigation-entry-edit">
				<form>
					<input v-model="newCalendarName"
						v-tooltip="{
							content: tooltipMessage,
							show: showTooltip('list_' + calendar.id),
							trigger: 'manual'
						}"
						class="edit"
						type="text"
						@keyup="checkName($event, calendar, save)">
					<input :title="t('tasks', 'Cancel')"
						type="cancel"
						value=""
						class="action icon-close"
						@click="resetView">
					<input :title="t('tasks', 'Save')"
						type="button"
						value=""
						class="action icon-checkmark"
						@click="save(calendar)">
				</form>
				<Colorpicker :selected-color="selectedColor" @color-selected="setColor(...arguments)" />
			</div>
		</li>
	</AppNavigationItem>
</template>

<script>
import Colorpicker from './Colorpicker.vue'
import ShareCalendar from './CalendarShare.vue'

import { showSuccess, showError } from '@nextcloud/dialogs'
import { translate as t, translatePlural as n } from '@nextcloud/l10n'
import { generateRemoteUrl } from '@nextcloud/router'
import Avatar from '@nextcloud/vue/dist/Components/Avatar'
import AppNavigationItem from '@nextcloud/vue/dist/Components/AppNavigationItem'
import AppNavigationCounter from '@nextcloud/vue/dist/Components/AppNavigationCounter'
import AppNavigationIconBullet from '@nextcloud/vue/dist/Components/AppNavigationIconBullet'
import Actions from '@nextcloud/vue/dist/Components/Actions'
import ActionButton from '@nextcloud/vue/dist/Components/ActionButton'
import ActionLink from '@nextcloud/vue/dist/Components/ActionLink'
import Tooltip from '@nextcloud/vue/dist/Directives/Tooltip'

import Close from 'vue-material-design-icons/Close'
import Delete from 'vue-material-design-icons/Delete'
import Download from 'vue-material-design-icons/Download'
import LinkVariant from 'vue-material-design-icons/LinkVariant'
import Pencil from 'vue-material-design-icons/Pencil'
import ShareVariant from 'vue-material-design-icons/ShareVariant'
import Undo from 'vue-material-design-icons/Undo'

import ClickOutside from 'v-click-outside'
import { mapGetters, mapActions } from 'vuex'

const CD_DURATION = 7

export default {
	components: {
		Colorpicker,
		ShareCalendar,
		Avatar,
		AppNavigationItem,
		AppNavigationCounter,
		AppNavigationIconBullet,
		Actions,
		ActionButton,
		ActionLink,
		Close,
		Delete,
		Download,
		LinkVariant,
		Pencil,
		ShareVariant,
		Undo,
	},
	directives: {
		clickOutside: ClickOutside.directive,
		Tooltip,
	},
	props: {
		calendar: {
			type: Object,
			required: true,
		},
	},
	data() {
		return {
			editing: false,
			shareOpen: false,
			copySuccess: false,
			copied: false,
			nameError: false,
			newCalendarName: '',
			selectedColor: '',
			tooltipMessage: '',
			tooltipTarget: '',
			// Deleting
			deleteInterval: null,
			deleteTimeout: null,
			countdown: CD_DURATION,
		}
	},
	computed: {
		...mapGetters({
			getCalendarCount: 'getCalendarCount',
			isCalendarNameUsed: 'isCalendarNameUsed',
			getTask: 'getTaskByUri',
			getPrincipalByUrl: 'getPrincipalByUrl',
		}),

		calendarCount() {
			return this.getCalendarCount(this.calendar.id)
		},

		deleteMessage() {
			if (this.calendar.supportsEvents) {
				return !this.calendar.isSharedWithMe
					? t('tasks', 'This will delete the calendar "{calendar}" and all corresponding events and tasks.', { calendar: this.calendar.displayName }, undefined, { sanitize: false, escape: false })
					: t('tasks', 'This will unshare the calendar "{calendar}".', { calendar: this.calendar.displayName }, undefined, { sanitize: false, escape: false })
			} else {
				return !this.calendar.isSharedWithMe
					? t('tasks', 'This will delete the list "{list}" and all corresponding tasks.', { list: this.calendar.displayName }, undefined, { sanitize: false, escape: false })
					: t('tasks', 'This will unshare the list "{list}".', { list: this.calendar.displayName }, undefined, { sanitize: false, escape: false })
			}
		},
		undoDeleteMessage() {
			if (this.calendar.supportsEvents) {
				return !this.calendar.isSharedWithMe
					? n('tasks', 'Deleting the calendar in {countdown} second', 'Deleting the calendar in {countdown} seconds', this.countdown, { countdown: this.countdown })
					: n('tasks', 'Unsharing the calendar in {countdown} second', 'Unsharing the calendar in {countdown} seconds', this.countdown, { countdown: this.countdown })
			} else {
				return !this.calendar.isSharedWithMe
					? n('tasks', 'Deleting the list in {countdown} second', 'Deleting the list in {countdown} seconds', this.countdown, { countdown: this.countdown })
					: n('tasks', 'Unsharing the list in {countdown} second', 'Unsharing the list in {countdown} seconds', this.countdown, { countdown: this.countdown })
			}
		},
		exportUrl() {
			let url = this.calendar.url
			// cut off last slash to have a fancy name for the ics
			if (url.slice(url.length - 1) === '/') {
				url = url.slice(0, url.length - 1)
			}
			url += '?export'
			return url
		},
		hasShares() {
			return this.calendar.shares.length > 0
		},
		// info tooltip about number of shares
		sharedWithTooltip() {
			return this.hasShares
				? n('tasks',
					'Shared with {num} entity',
					'Shared with {num} entities',
					this.calendar.shares.length, {
						num: this.calendar.shares.length,
					})
				: '' // disable the tooltip
		},
		/**
		 * Whether or not the information about the owner principal was loaded
		 *
		 * @return {boolean}
		 */
		loadedOwnerPrincipal() {
			return this.getPrincipalByUrl(this.calendar.owner) !== undefined
		},
		ownerUserId() {
			const principal = this.getPrincipalByUrl(this.calendar.owner)
			if (principal) {
				return principal.userId
			}
			return ''
		},
		ownerDisplayname() {
			const principal = this.getPrincipalByUrl(this.calendar.owner)
			if (principal) {
				return principal.displayname
			}
			return ''
		},
	},
	methods: {
		t,

		...mapActions([
			'changeCalendar',
			'deleteCalendar',
			'moveTask',
		]),

		/**
		 * Format the task counter
		 *
		 * @param {number} count The number of tasks
		 */
		counterFormatter(count) {
			switch (false) {
			case count !== 0:
				return ''
			case count < 999:
				return '999+'
			default:
				return count
			}
		},
		/**
		 * Handle the drag over
		 *
		 * @param {object} e The event object
		 * @return {boolean}
		 */
		dragOver(e) {
			if (e.preventDefault) {
				e.preventDefault()
			}
			return false
		},
		/**
		 * Set the appropriate class on hovering
		 *
		 * @param {object} e The event object
		 */
		dragEnter(e) {
			// Check if dropping here is allowed
			if (this.calendar.readOnly) {
				return
			}
			if (this.calendar.isSharedWithMe) {
				const taskUri = e.dataTransfer.getData('text/plain')
				if (taskUri) {
					const task = this.getTask(taskUri)
					if (task?.class !== 'PUBLIC') {
						return
					}
				}
			}
			// Get the correct element, in case we hover a child.
			if (e.target.closest) {
				const target = e.target.closest('li.list')
				if (target) {
					const calendars = document.querySelectorAll('li.list')
					calendars.forEach((f) => { f.classList.remove('dnd-hover') })
					target.classList.add('dnd-hover')
				}
			}
		},
		/**
		 * Remove the hovering class after leaving
		 *
		 * @param {object} e The event object
		 */
		dragLeave(e) {
			// Don't do anything if we leave towards a child element.
			if (e.target.contains(e.relatedTarget)) {
				return
			}
			// Get the correct element, in case we leave directly from a child.
			if (e.target.closest) {
				const target = e.target.closest('li.list')
				if (!target || target.contains(e.relatedTarget)) {
					return
				}
				target.classList.remove('dnd-hover')
			}
		},
		/**
		 * Drop a task on a calendar
		 *
		 * @param {object} e The event object
		 */
		dropTask(e) {
			// Remove all hover classes
			const calendars = document.querySelectorAll('li.list')
			calendars.forEach((f) => { f.classList.remove('dnd-hover') })
			const taskUri = e.dataTransfer.getData('text/plain')
			if (taskUri) {
				const task = this.getTask(taskUri)
				if (task && this.calendar !== task.calendar) {
					this.moveTask({ task, calendar: this.calendar, parent: undefined })
				}
			}
		},
		showTooltip(target) {
			return this.tooltipTarget === target
		},
		editCalendar() {
			this.editing = true
			this.newCalendarName = this.calendar.displayName
			this.selectedColor = this.calendar.color
			this.nameError = false
			this.tooltipTarget = ''
			this.$nextTick(
				() => document.querySelector('#list_' + this.calendar.id + ' input.edit').focus()
			)
		},

		/**
		 * Toggles the visibility of the share menu
		 */
		toggleShare() {
			this.shareOpen = !this.shareOpen
		},
		resetView() {
			this.editing = false
			this.shareOpen = false
			this.tooltipTarget = ''
		},
		clickOutsideMiddleware(event) {
			return !event.target.closest('.edit-calendar')
		},
		async copyCalDAVUrl(event) {
			// change to loading status
			event.stopPropagation()

			const url = String(new URL(this.calendar.url, generateRemoteUrl('dav')))

			// copy link for calendar to clipboard
			try {
				await this.$copyText(url)
				event.preventDefault()
				this.copySuccess = true
				this.copied = true
				// Notify calendar url was copied
				const msg = this.calendar.supportsEvents
					? t('tasks', 'Calendar link copied to clipboard.')
					: t('tasks', 'List link copied to clipboard.')
				console.debug(msg)
				showSuccess(msg)
			} catch (e) {
				this.copySuccess = false
				this.copied = true
				const msg = this.calendar.supportsEvents
					? t('tasks', 'Calendar link could not be copied to clipboard.')
					: t('tasks', 'List link could not be copied to clipboard.')
				showError(msg)
			} finally {
				setTimeout(() => {
					// stop loading status regardless of outcome
					this.copied = false
				}, 2000)
			}
		},
		setColor(color) {
			this.selectedColor = color
		},
		save() {
			if (!this.isNameAllowed(this.newCalendarName, this.calendar.id).allowed) {
				return
			}
			this.changeCalendar({ calendar: this.calendar, newName: this.newCalendarName, newColor: this.selectedColor })
			this.editing = false
		},
		checkName(event, calendar, callback) {
			const calendarId = calendar ? calendar.id : ''
			const check = this.isNameAllowed(this.newCalendarName, calendarId)
			this.tooltipMessage = check.msg
			if (!check.allowed) {
				this.tooltipTarget = 'list_' + calendarId
				this.nameError = true
			} else {
				this.tooltipTarget = ''
				this.nameError = false
			}
			if (event.keyCode === 13) {
				callback(calendar)
			}
			if (event.keyCode === 27) {
				event.preventDefault()
				this.tooltipTarget = ''
				this.creating = false
				this.editing = false
				this.nameError = false
			}
		},
		isNameAllowed(name, id) {
			const check = {
				allowed: false,
				msg: '',
			}
			if (this.isCalendarNameUsed(name, id)) {
				check.msg = t('tasks', 'The name "{calendar}" is already used.', { calendar: name })
			} else if (!name) {
				check.msg = t('tasks', 'An empty name is not allowed.')
			} else {
				check.allowed = true
			}
			return check
		},

		/**
		 * Deletes or unshares the calendar
		 */
		scheduleDelete() {
			this.deleteInterval = setInterval(() => {
				this.countdown--
				if (this.countdown < 0) {
					this.countdown = 0
				}
			}, 1000)
			this.deleteTimeout = setTimeout(async () => {
				try {
					await this.deleteCalendar(this.calendar)
				} catch (error) {
					const msg = this.calendar.supportsEvents
						? t('tasks', 'An error occurred, unable to delete the calendar.')
						: t('tasks', 'An error occurred, unable to delete the list.')
					showError(msg)
					console.error(error)
				} finally {
					clearInterval(this.deleteInterval)
					this.deleteTimeout = null
					this.deleteInterval = null
					this.countdown = CD_DURATION
				}
			}, 1e3 * CD_DURATION)
		},
		/**
		 * Cancels the deletion of a calendar
		 */
		cancelDelete() {
			clearTimeout(this.deleteTimeout)
			clearInterval(this.deleteInterval)
			this.deleteTimeout = null
			this.deleteInterval = null
			this.countdown = CD_DURATION
		},
	},
}
</script>

<style lang="scss" scoped>
$color-error: #e9322d;

.list::v-deep {
	&.active .app-navigation-entry__icon-bullet > div {
		height: 16px;
		width: 16px;
		margin: -1px;
	}

	&:not(.active) > .app-navigation-entry__utils .action-item:not(.shared) {
		display: none;
	}

	&.list--edit {
		.app-navigation-entry__utils,
		.app-navigation-entry-link {
			display: none;
		}

		.app-navigation-entry-edit {
			display: inline-block;
			width: 100%;
		}
	}

	&.list--deleted {
		.app-navigation-entry__title {
			text-decoration: line-through;
		}

		.app-navigation-entry__icon-bullet {
			opacity: .3;
		}
	}

	.app-navigation-entry__utils .icon-loading {
		height: 32px;
		width: 32px;
	}

	.app-navigation-entry__counter-wrapper .action-item.sharing:not(.shared) {
		opacity: .3;
	}

	.app-navigation-entry-edit {
		padding-left: 5px !important;
		display: none;
		position: relative;

		&.error input.edit {
			color: var(--color-error);
			border-color: var(--color-error) !important;
			box-shadow: 0 0 6px transparentize( $color-error, .7 );
		}

		form {
			display: flex;

			input {
				margin-right: 0;

				&[type='text'] {
					flex-grow: 1;
				}

				&.action {
					background-color: var(--color-background-dark);
					width: 36px;
					border-left: 0 none;
					background-position: center;
					cursor: pointer;

					&:hover {
						border-left: 1px solid;
						margin-left: -1px;
						width: 37px;
					}
				}
			}
		}
	}
}
</style>
