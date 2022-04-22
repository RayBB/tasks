/**
 * Nextcloud - Tasks
 *
 * @author Raimund Schlüßler
 *
 * @copyright 2018 Raimund Schlüßler <raimund.schluessler@mailbox.org>
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU AFFERO GENERAL PUBLIC LICENSE for more details.
 *
 * You should have received a copy of the GNU Affero General Public
 * License along with this library. If not, see <http://www.gnu.org/licenses/>.
 *
 */
'use strict'

import App from './App.vue'
import router from './router.js'
import store from './store/store.js'

import { linkTo } from '@nextcloud/router'

import AlertBoxOutline from 'vue-material-design-icons/AlertBoxOutline'
import CalendarRemove from 'vue-material-design-icons/CalendarRemove'
import Cancel from 'vue-material-design-icons/Cancel'
import Check from 'vue-material-design-icons/Check'
import Delete from 'vue-material-design-icons/Delete'
import Eye from 'vue-material-design-icons/Eye'
import EyeOff from 'vue-material-design-icons/EyeOff'
import Pulse from 'vue-material-design-icons/Pulse'
import Tag from 'vue-material-design-icons/Tag'
import TrendingUp from 'vue-material-design-icons/TrendingUp'

import { createApp } from 'vue'
import { sync } from 'vuex-router-sync'
// eslint-disable-next-line import/no-named-as-default
// import VueClipboard from 'vue-clipboard2'

// Disable on production
// Vue.config.devtools = true
// Vue.config.performance = true

// CSP config for webpack dynamic chunk loading
// eslint-disable-next-line
__webpack_nonce__ = btoa(OC.requestToken)

// Correct the root of the app for chunk loading
// linkTo matches the apps folders
// generateUrl ensure the index.php (or not)
// We do not want the index.php since we're loading files
// eslint-disable-next-line
__webpack_public_path__ = linkTo('tasks', 'js/')

sync(store, router)

// Vue.use(VueClipboard)

if (!OCA.Tasks) {
	/**
	 * @namespace OCA.Tasks
	 */
	OCA.Tasks = {}
}

// Vue.prototype.$OC = OC
// Vue.prototype.$OCA = OCA
// Vue.prototype.$appVersion = appVersion

const Tasks = createApp(App)
	.component('IconAlertBoxOutline', AlertBoxOutline)
	.component('IconCalendarRemove', CalendarRemove)
	.component('IconCancel', Cancel)
	.component('IconCheck', Check)
	.component('IconDelete', Delete)
	.component('IconEye', Eye)
	.component('IconEyeOff', EyeOff)
	.component('IconPulse', Pulse)
	.component('IconTag', Tag)
	.component('IconTrendingUp', TrendingUp)
	.use(router)
	.use(store)
	.mount('.app-tasks')

OCA.Tasks.App = Tasks
