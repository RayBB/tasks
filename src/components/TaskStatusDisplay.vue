<!--
Nextcloud - Tasks

@author Raimund Schlüßler
@copyright 2021 Raimund Schlüßler <raimund.schluessler@mailbox.org>

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
	<Actions v-if="status" :disabled="isDisabled">
		<ActionButton :key="status.status" :disabled="isDisabled" @click="statusClicked">
			<template #icon>
				<AlertCircleOutline v-if="status.status==='error'" :size="20" class="status--error" />
				<Check v-if="status.status==='success'" :size="20" class="status--success" />
				<Loading v-if="status.status==='sync'" :size="20" class="status--sync" />
				<SyncAlert v-if="status.status==='conflict'" :size="20" class="status--conflict" />
			</template>
			{{ status.message }}
		</ActionButton>
	</Actions>
</template>

<script>
import Actions from '@nextcloud/vue/dist/Components/Actions'
import ActionButton from '@nextcloud/vue/dist/Components/ActionButton'

import AlertCircleOutline from 'vue-material-design-icons/AlertCircleOutline'
import Check from 'vue-material-design-icons/Check'
import Loading from 'vue-material-design-icons/Loading'
import SyncAlert from 'vue-material-design-icons/SyncAlert'

export default {
	name: 'TaskStatusDisplay',
	components: {
		Actions,
		ActionButton,
		AlertCircleOutline,
		Check,
		Loading,
		SyncAlert,
	},
	props: {
		status: {
			type: Object,
			default: null,
		},
	},
	data() {
		return {
			resetStatusTimeout: null,
		}
	},
	computed: {
		isDisabled() {
			return this.status.status !== 'conflict'
		},
	},
	watch: {
		status(newStatus) {
			this.checkTimeout(newStatus)
		},
	},
	mounted() {
		this.checkTimeout(this.status)
	},
	methods: {
		statusClicked() {
			this.$emit('status-clicked')
		},
		checkTimeout(newStatus) {
			if (newStatus) {
				if (this.resetStatusTimeout) {
					clearTimeout(this.resetStatusTimeout)
				}
				if (newStatus.status === 'success') {
					this.resetStatusTimeout = setTimeout(
						() => {
							this.$emit('reset-status')
						}, 5000
					)
				}
			}
		},
	},
}
</script>

<style lang="scss" scoped>
.action-item {
	&:disabled {
		opacity: 1 !important;
	}
	.status {
		&--error {
			color: var(--color-error);
		}
		&--success {
			color: var(--color-success);
		}
		&--sync,
		&--conflict {
			::v-deep svg {
				animation-iteration-count: infinite;
				animation-duration: 1s;
			}
		}
		&--sync ::v-deep svg {
			animation-name: spin;
		}
		&--conflict {
			color: var(--color-warning);
			::v-deep svg {
				animation-name: pulse;
				border-radius: 50%;
			}
		}
	}
}
@keyframes spin {
	0% {
		transform: rotate(0deg);
	}
	100% {
		transform: rotate(360deg);
	}
}
@keyframes pulse {
	0% {
		box-shadow: 0 0 0 0 rgba(50, 50, 50, .4);
	}
	70% {
		box-shadow: 0 0 0 10px rgba(50, 50, 50, 0);
	}
	100% {
		box-shadow: 0 0 0 0 rgba(50, 50, 50, 0);
	}
}
</style>
