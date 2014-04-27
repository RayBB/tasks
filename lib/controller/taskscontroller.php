<?php

/**
* ownCloud - Tasks
*
* @author Raimund Schlüßler
* @copyright 2013 Raimund Schlüßler raimund.schluessler@googlemail.com
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

namespace OCA\Tasks_enhanced\Controller;

use OCA\Tasks_enhanced\Controller,
	OCA\Tasks_enhanced\Helper,
	OCP\AppFramework\Http\JSONResponse;

class TasksController extends Controller {

	/**
	 * @NoAdminRequired
	 */
	public function getTasks(){
		$userId = $this->api->getUserId();
		$calendars = \OC_Calendar_Calendar::allCalendars($userId, true);
		$user_timezone = \OC_Calendar_App::getTimezone();

		$tasks = array();
		foreach( $calendars as $calendar ) {
			$calendar_tasks = \OC_Calendar_Object::all($calendar['id']);
			foreach( $calendar_tasks as $task ) {
				if($task['objecttype']!='VTODO') {
					continue;
				}
				if(is_null($task['summary'])) {
					continue;
				}
				$vtodo = Helper::parseVTODO($task['calendardata']);
				try {
					$task_data = Helper::arrayForJSON($task['id'], $vtodo, $user_timezone);
					$task_data['calendarid'] = $calendar['id'];
					$tasks[] = $task_data;
				} catch(\Exception $e) {
					\OCP\Util::writeLog('tasks_enhanced', $e->getMessage(), \OCP\Util::ERROR);
				}
			}
		}

		$result = array(
			'data' => array(
				'tasks' => $tasks
				)
			);
		$response = new JSONResponse();
		$response->setData($result);
		return $response;
	}

	private function setStarred($isStarred){
		$taskId = (int) $this->params('taskID');
		try {
			$vcalendar = \OC_Calendar_App::getVCalendar($taskId);
			$vtodo = $vcalendar->VTODO;
			if($isStarred){
				$vtodo->setString('PRIORITY',1);
			}else{
				$vtodo->__unset('PRIORITY');
			}
			\OC_Calendar_Object::edit($taskId, $vcalendar->serialize());
		} catch(\Exception $e) {
			// throw new BusinessLayerException($e->getMessage());
		}
	}

	/**
	 * @NoAdminRequired
	 */
	public function starTask(){
		$response = new JSONResponse();
		try {
			$this->setStarred(true);
			return $response;
		} catch(\Exception $e) {
			return $response;
			// return $this->renderJSON(array(), $e->getMessage());
		}
	}

	/**
	 * @NoAdminRequired
	 */
	public function unstarTask(){
		$response = new JSONResponse();
		try {
			$this->setStarred(false);
			return $response;
		} catch(\Exception $e) {
			return $response;
			// return $this->renderJSON(array(), $e->getMessage());
		}
	}

	private function setCompleted($isCompleted){
		$taskId = (int) $this->params('taskID');
		$percent_complete = $isCompleted ? '100' : '0';
		$isCompleted = null;
		try {
			$vcalendar = \OC_Calendar_App::getVCalendar($taskId);
			$vtodo = $vcalendar->VTODO;
			if (!empty($percent_complete)) {
				$vtodo->setString('PERCENT-COMPLETE', $percent_complete);
			}else{
				$vtodo->__unset('PERCENT-COMPLETE');
			}

			if ($percent_complete == 100) {
				if (!$isCompleted) {
					$isCompleted = 'now';
				}
			} else {
				$isCompleted = null;
			}
			if ($isCompleted) {
				$timezone = \OC_Calendar_App::getTimezone();
				$timezone = new \DateTimeZone($timezone);
				$isCompleted = new \DateTime($isCompleted, $timezone);
				$vtodo->setDateTime('COMPLETED', $isCompleted);
			} else {
				unset($vtodo->COMPLETED);
			}
			\OC_Calendar_Object::edit($taskId, $vcalendar->serialize());
		} catch(\Exception $e) {
			// throw new BusinessLayerException($e->getMessage());
		}
	}

	/**
	 * @NoAdminRequired
	 */
	public function completeTask(){
		$response = new JSONResponse();
		try {
			$this->setCompleted(true);
			return $response;
		} catch(\Exception $e) {
			return $response;
			// return $this->renderJSON(array(), $e->getMessage());
		}
	}

	/**
	 * @NoAdminRequired
	 */
	public function uncompleteTask(){
		$response = new JSONResponse();
		try {
			$this->setCompleted(false);
			return $response;
		} catch(\Exception $e) {
			return $response;
			// return $this->renderJSON(array(), $e->getMessage());
		}
	}

	/**
	 * @NoAdminRequired
	 */
	public function addTask(){
		$taskName = $this->params('name');
		$calendarId = $this->params('calendarID');
		$starred = $this->params('starred');
		$due = $this->params('due');
		$start = $this->params('start');
		$response = new JSONResponse();
		$userId = $this->api->getUserId();
		$calendars = \OC_Calendar_Calendar::allCalendars($userId, true);
		$user_timezone = \OC_Calendar_App::getTimezone();
		$request = array(
				'summary'			=> $taskName,
				'categories'		=> null,
				'priority'			=> $starred,
				'location' 			=> null,
				'due'				=> $due,
				'start'				=> $start,
				'description'		=> null
			);
		$vcalendar = Helper::createVCalendarFromRequest($request);
		$taskId = \OC_Calendar_Object::add($calendarId, $vcalendar->serialize());

		$task = Helper::arrayForJSON($taskId, $vcalendar->VTODO, $user_timezone);
		$task['calendarid'] = $calendarId;

		$task['tmpID'] = $this->params('tmpID');
		$result = array(
			'data' => array(
				'task' => $task
				)
		);
		$response->setData($result);
		return $response;
	}

	/**
	 * @NoAdminRequired
	 */
	public function deleteTask(){
		$response = new JSONResponse();
		$taskId = $this->params('taskID');
		$task = \OC_Calendar_App::getEventObject($taskId);
		\OC_Calendar_Object::delete($taskId);
		return $response;
	}

	/**
	 * @NoAdminRequired
	 */
	public function setTaskName(){
		$taskId = (int) $this->params('taskID');
		$taskName = $this->params('name');
		$response = new JSONResponse();
		try {
			$vcalendar = \OC_Calendar_App::getVCalendar($taskId);
			$vtodo = $vcalendar->VTODO;
			$vtodo->setString('SUMMARY', $taskName);
			\OC_Calendar_Object::edit($taskId, $vcalendar->serialize());
		} catch(\Exception $e) {
			// throw new BusinessLayerException($e->getMessage());
		}
		return $response;
	}

	/**
	 * @NoAdminRequired
	 */
	public function setTaskCalendar(){
		$taskId = $this->params('taskID');
		$calendarId = $this->params('calendarID');
		$response = new JSONResponse();
		try {
			$data = \OC_Calendar_App::getEventObject($taskId);
			if ($data['calendarid'] != $calendar) {
				\OC_Calendar_Object::moveToCalendar($taskId, $calendarId);
			}
		} catch(\Exception $e) {
			// throw new BusinessLayerException($e->getMessage());
		}
		return $response;
	}

	/**
	 * @NoAdminRequired
	 */
	public function setTaskNote(){
		$taskId = $this->params('taskID');
		$note = $this->params('note');
		$response = new JSONResponse();
		try {
			$vcalendar = \OC_Calendar_App::getVCalendar($taskId);
			$vtodo = $vcalendar->VTODO;
			$vtodo->setString('DESCRIPTION', $note);
			\OC_Calendar_Object::edit($taskId, $vcalendar->serialize());
		} catch(\Exception $e) {
			// throw new BusinessLayerException($e->getMessage());
		}
		return $response;
	}

	/**
	 * @NoAdminRequired
	 */
	public function setDueDate(){
		$taskId = $this->params('taskID');
		$due = $this->params('due');
		$response = new JSONResponse();
		try{
			$vcalendar = \OC_Calendar_App::getVCalendar($taskId);
			$vtodo = $vcalendar->VTODO;
			$type = null;
			if ($due != 'false') {
				$timezone = \OC_Calendar_App::getTimezone();
				$timezone = new \DateTimeZone($timezone);

				$due = new \DateTime('@'.$due);
				$due->setTimezone($timezone);
				$type = \Sabre\VObject\Property\DateTime::LOCALTZ;
				// if ($due_date_only) {
				// 	$type = \Sabre\VObject\Property\DateTime::DATE;
				// }
			}
		} catch (\Exception $e) {

		}
		$vtodo->setDateTime('DUE', $due, $type);
		\OC_Calendar_Object::edit($taskId, $vcalendar->serialize());
		return $response;
	}

	/**
	 * @NoAdminRequired
	 */
	public function setStartDate(){
		$taskId = $this->params('taskID');
		$start = $this->params('start');
		$response = new JSONResponse();

		try{
			$vcalendar = \OC_Calendar_App::getVCalendar($taskId);
			$vtodo = $vcalendar->VTODO;
			$type = null;
			if ($start != 'false') {
				$timezone = \OC_Calendar_App::getTimezone();
				$timezone = new \DateTimeZone($timezone);

				$start = new \DateTime('@'.$start);
				$start->setTimezone($timezone);
				$type = \Sabre\VObject\Property\DateTime::LOCALTZ;
				// if ($due_date_only) {
				// 	$type = \Sabre\VObject\Property\DateTime::DATE;
				// }
			}
		} catch (\Exception $e) {

		}
		$vtodo->setDateTime('DTSTART', $start, $type);
		\OC_Calendar_Object::edit($taskId, $vcalendar->serialize());
		return $response;
	}

	/**
	 * @NoAdminRequired
	 */
	public function setReminderDate(){
		$taskId = $this->params('taskID');
		$type = $this->params('type');
		$action = $this->params('action');
		// $date = $this->params('date');
		$response = new JSONResponse();

		$types = array('DATE-TIME','DURATION');

		$vcalendar = \OC_Calendar_App::getVCalendar($taskId);
		$vtodo = $vcalendar->VTODO;
		$valarm = $vtodo->VALARM;

		if ($type == false){
			unset($vtodo->VALARM);
			\OC_Calendar_Object::edit($taskId, $vcalendar->serialize());
		}
		elseif (in_array($type,$types)) {
			try{
				if($valarm == null) {
					$valarm = new \OC_VObject('VALARM');
					$valarm->setString('ACTION', $action);
					$valarm->setString('DESCRIPTION', 'Default Event Notification');
					$valarm->setString('');
					$vtodo->add($valarm);
				} else {
					unset($valarm->TRIGGER);
				}
				$triggervalue = '';
				if ($type == 'DATE-TIME') {
					$date = new \DateTime('@'.$this->params('date'));
					$triggervalue = $date->format('Ymd\THis\Z');
				} elseif ($type == 'DURATION') {
					// TODO
					$triggervalue = '-PT5M';
				}
				$valarm->addProperty('TRIGGER', $triggervalue, array('VALUE' => $type));
				\OC_Calendar_Object::edit($taskId, $vcalendar->serialize());
			} catch (\Exception $e) {

			}
		}

		return $response;
	}

	/**
	 * @NoAdminRequired
	 */
	public function setCategories($taskId, $categories){
		$taskId = $this->params('taskID');
		$categories = $this->params('categories');
		$response = new JSONResponse();
		try {
			$vcalendar = \OC_Calendar_App::getVCalendar($taskId);
			$vtodo = $vcalendar->VTODO;
			$vtodo->setString('CATEGORIES', $categories);
			\OC_Calendar_Object::edit($taskId, $vcalendar->serialize());
		} catch(\Exception $e) {
			// throw new BusinessLayerException($e->getMessage());
		}
		return $response;
	}

	/**
	 * @NoAdminRequired
	 */
	public function setLocation($taskId, $location){
		$taskId = $this->params('taskID');
		$location = $this->params('location');
		$response = new JSONResponse();
		try {
			$vcalendar = \OC_Calendar_App::getVCalendar($taskId);
			$vtodo = $vcalendar->VTODO;
			$vtodo->setString('LOCATION', $location);
			\OC_Calendar_Object::edit($taskId, $vcalendar->serialize());
		} catch(\Exception $e) {
			// throw new BusinessLayerException($e->getMessage());
		}
		return $response;
	}


}