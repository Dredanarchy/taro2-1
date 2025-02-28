var AIComponent = TaroEntity.extend({
	classId: 'AIComponent',
	componentId: 'ai',

	init: function (unit) {
		var self = this;
		self._entity = unit;
		self.targetUnitId = undefined;
		self.targetPosition = undefined;
		self.unitsTargetingMe = []; // unit IDs of units attacking/fleeing away from this unit
		self.debugEnabled = true;

		// A* algorithm variables
		self.path = []; // AI unit will keep going to highest index until there is no more node to go

		// AI settings

		// sensor needs to be enabled regardless of AI to process sensor collision triggers
		// for example, in cell-eater, items are consumed via sensors
		if (unit._stats.ai) {

			if (unit._stats.ai.sensorRadius > 0 && unit.sensor == undefined) {
				unit.sensor = new Sensor(unit, unit._stats.ai.sensorRadius);
		   }

			unit._stats.aiEnabled = unit._stats.ai.enabled;
			if (unit._stats.aiEnabled) {
				self.enable();
			}
		}
	},

	enable: function() {
		var self = this;
		var unit = self._entity;
		unit._stats.aiEnabled = true;
		if (taro.isServer) {
			unit.streamUpdateData([{aiEnabled: true }]);
		}

		self.pathFindingMethod = unit._stats.ai.pathFindingMethod; // options: simple/a* (coming soon)
		self.idleBehaviour = unit._stats.ai.idleBehaviour; // options: wander/stay
		self.sensorResponse = unit._stats.ai.sensorResponse; // options: none/flee/none (default)
		self.attackResponse = unit._stats.ai.attackResponse; // options: fight/flee/none (default)
		self.maxTravelDistance = unit._stats.ai.maxTravelDistance; // how far unit's willing to flee/chase target until returning to its spawn position - options: undefined value for infinite distance
		self.letGoDistance = unit._stats.ai.letGoDistance; // options: undefined value for infinite distance
		self.maxAttackRange = unit._stats.ai.maxAttackRange;
		self.previousPosition = { x: unit._translate.x, y: unit._translate.y }; // last position recorded before fleeing
		self.nextMoveAt = taro._currentTime;
		self.goIdle();

		// if (unit._stats.ai.sensorRadius > 0 && unit.sensor == undefined) {
		// 	unit.sensor = new Sensor(unit, unit._stats.ai.sensorRadius);
		// }
	},

	disable: function() {
		var unit = this._entity;
		unit._stats.aiEnabled = false;

		if (taro.isServer) {
			unit.streamUpdateData([{aiEnabled: false }]);
		}

		if (unit.sensor) {
			// unit.sensor.remove();
		}
		unit.ability.stopUsingItem();
		unit.stopMoving();
		this.targetUnitId = undefined;
		this.targetPosition = undefined;
		this.currentAction = undefined;
		this.nextMoveAt = undefined;
	},

	registerAttack: function (unit) {
		var self = this;
		// only response to hostile/neutral units
		var ownerPlayer = self._entity.getOwner();
		if (unit) {
			var ownerPlayerOfTargetUnit = unit.getOwner();
			if (ownerPlayer && ownerPlayer.isHostileTo(ownerPlayerOfTargetUnit)) {
				// if I already have a target, re-target if new target unit is closer
				var targetUnit = this.getTargetUnit();
				if (targetUnit == undefined || (targetUnit && self.getDistanceToUnit(unit)) < self.getDistanceToUnit(targetUnit)) {
					switch (self.attackResponse) {
						case 'fight':
							self.attackUnit(unit);
							break;
						case 'flee':
							self.fleeFromUnit(unit);
							break;
					}
				}
			}
		}
	},

	registerSensorDetection: function (unit) {
		var self = this;
		// only response to hostile/neutral units
		var ownerPlayer = self._entity.getOwner();
		if (unit) {
			var ownerPlayerOfTargetUnit = taro.$(unit._stats.ownerId);
			if (ownerPlayer && ownerPlayer.isHostileTo(ownerPlayerOfTargetUnit) && unit._stats.isUnTargetable != true) {
				// if I already have a target, re-target if new target unit is closer
				var targetUnit = this.getTargetUnit();
				if (targetUnit == undefined || (self.maxAttackRange < this.getDistanceToTarget())) {
					switch (self.sensorResponse) {
						case 'fight':
							// if (self.currentAction != 'fight') {
							self.attackUnit(unit);
							// }
							break;
						case 'flee':
							self.fleeFromUnit(unit);
							break;
					}
				}
			}
		}
	},

	// all units that were targeting this unit will no longer target this unit
	announceDeath: function () {
		var unitIds = this.unitsTargetingMe;
		for (var i = 0; i < unitIds.length; i++) {
			var attackingUnit = taro.$(unitIds[i]);
			if (attackingUnit && attackingUnit.ai.getTargetUnit() == this._entity && attackingUnit.sensor && attackingUnit._stats.ai && attackingUnit._stats.aiEnabled) {
				attackingUnit.ai.goIdle();
				attackingUnit.sensor.updateBody(); // re-detect nearby units
			}
		}
		this.targetUnitId = undefined;
		this.targetPosition = undefined;
		this.unitsTargetingMe = [];
	},

	getTargetUnit: function () {
		if (this.targetUnitId)
			return taro.$(this.targetUnitId);

		return undefined;
	},

	getAngleToTarget: function () {
		var unit = this._entity;
		var targetPosition = this.getTargetPosition();
		if (targetPosition) {
			return Math.atan2(targetPosition.y - unit._translate.y, targetPosition.x - unit._translate.x) + Math.radians(90);
		}

		return undefined;
	},

	// return distance to target position or target unit (if this.targetUnit is set)
	getDistanceToTarget: function () {
		var unit = this._entity;
		var distance = 99999999999; // set distance as infinite by default

		// if target is a unit, then consider the radius of the both this unit and target unit
		var targetUnit = this.getTargetUnit();
		if (targetUnit) {
			distance = this.getDistanceToUnit(targetUnit);
		} else {
			var targetPosition = this.getTargetPosition();
			if (targetPosition) {
				var a = unit._translate.x - targetPosition.x;
				var b = unit._translate.y - targetPosition.y;
				var distance = Math.sqrt(a * a + b * b);
			}
		}

		return distance;
	},

	// return distance with consideration of both units body radius
	getDistanceToUnit: function (targetUnit) {
		var myUnit = this._entity;
		if (targetUnit) {
			var a = Math.abs(myUnit._translate.x - targetUnit._translate.x);
			var b = Math.abs(myUnit._translate.y - targetUnit._translate.y);
			var distanceFromCenter = Math.sqrt(a * a + b * b);
		}

		var myUnitReach = myUnit.height() / 2;
		var targetUnitRadius = targetUnit.width() / 2;

		return distanceFromCenter - targetUnitRadius - myUnitReach;
	},

	// return target position whether it's a unit or a position.
	getTargetPosition: function () {
		var targetUnit = this.getTargetUnit();
		if (targetUnit && this.pathFindingMethod == 'simple') { // only set target position for simple pathfinding
			return { x: targetUnit._translate.x, y: targetUnit._translate.y };
		}
		if (this.targetPosition) {
			return this.targetPosition;
		}
		return undefined;
	},

	goIdle: function () {
		var unit = this._entity;
		unit.ability.stopUsingItem();
		unit.stopMoving();
		this.targetUnitId = undefined;
		this.targetPosition = undefined;
		this.currentAction = 'idle';
		this.nextMoveAt = taro._currentTime + 2000 + Math.floor(Math.random() * 2000);
	},

	fleeFromUnit: function (unit) {
		this.setTargetUnit(unit);
		switch (this.pathFindingMethod) {
			case 'simple':
				this.targetPosition = undefined;
				break;
			case 'a*':
				this.setTargetPosition(this._entity._translate.x + (unit._translate.x - this._entity._translate.x), this._entity._translate.y + (unit._translate.y - this._entity._translate.y));
				break;
		}
		// only update its return position if unit was provked while in idle state
		if (this.currentAction == 'idle') {
			this.previousPosition = { x: this._entity._translate.x, y: this._entity._translate.y };
		}
		this.currentAction = 'flee';
		this._entity.startMoving();
		this.nextMoveAt = taro._currentTime + 5000 + Math.floor(Math.random() * 5000);
	},

	attackUnit: function (unit) {
		this.setTargetUnit(unit);
		// only update its return position if unit was provked while in idle state
		if (this.currentAction == 'idle') {
			this.previousPosition = { x: this._entity._translate.x, y: this._entity._translate.y };
		}
		if (this.pathFindingMethod == 'a*') {
			this.path = this.getAStarPath(unit._translate.x, unit._translate.y);
			if (this.path.length > 0) {
				this.setTargetPosition(this.path[this.path.length - 1].x * taro.map.data.tilewidth + taro.map.data.tilewidth / 2, this.path[this.path.length - 1].y * taro.map.data.tilewidth + taro.map.data.tilewidth / 2);
			}
		}
		this.currentAction = 'fight';
		this._entity.startMoving();
		let targetAngle = this.getAngleToTarget();
		if (targetAngle && !this._entity._stats.currentBody?.fixedRotation) {
			this._entity.streamUpdateData([{rotate: targetAngle}]);
		}
	},

	moveToTargetPosition: function (x, y) {
		switch (this.pathFindingMethod)
		{
			case 'simple':
				this.setTargetPosition(x, y);
				break;
			case 'a*':
				this.path = this.getAStarPath(x, y);
				if (this.path.length > 0) {
					this.setTargetPosition(this.path[this.path.length - 1].x * taro.map.data.tilewidth + taro.map.data.tilewidth / 2, this.path[this.path.length - 1].y * taro.map.data.tilewidth + taro.map.data.tilewidth / 2);
				} else {
					return; // dont move if path failed to generate
				}
				break;
		}
		this.currentAction = 'move';
		this._entity.startMoving();
		this.targetUnitId = undefined;
	},

	/*
	* @param x
	* @param y
	* @return {Array}
	* Return array with x and y coordinates of the path (Start and End node Exclusive)
	* if the target location is inside a wall, not reachable, or the unit already at the target location, return empty array
	*/
	getAStarPath: function (x, y) {
		let unit = this._entity;
		let mapData = taro.map.data; // cache the map data for rapid use

		let unitTilePosition = {x: Math.floor(unit._translate.x / mapData.tilewidth), y: Math.floor(unit._translate.y / mapData.tilewidth)};
		let targetTilePosition = {x: Math.floor(x / mapData.tilewidth), y: Math.floor(y / mapData.tilewidth)};
		targetTilePosition.x = Math.min(Math.max(0, targetTilePosition.x), mapData.width - 1); // confine with map boundary
		targetTilePosition.y = Math.min(Math.max(0, targetTilePosition.y), mapData.height - 1);

		let wallMap = taro.map.wallMap; // wall layer cached
		let openList = []; // store grid nodes that is under evaluation
		let closeList = []; // store grid nodes that finished evaluation
		let tempPath = []; // store path to return (smaller index: closer to target, larger index: closer to start)
		if (wallMap[targetTilePosition.x + targetTilePosition.y * mapData.width] == 1) { // teminate if the target position is wall
			return [];
		}
		openList.push(_.cloneDeep({current: unitTilePosition, parent: {x: -1, y: -1}, totalHeuristic: 0})); // push start node to open List
		while (openList.length > 0) {
			let minNode = _.cloneDeep(openList[0]); // initialize for iteration
			let minNodeIndex = 0;
			for (let i = 1; i < openList.length; i++) {
				if (openList[i].totalHeuristic < minNode.totalHeuristic) { // only update the minNode if the totalHeuristic is smaller
					minNodeIndex = i;
					minNode = _.cloneDeep(openList[i]);
				}
			}
			openList.splice(minNodeIndex, 1); // remove node with smallest distance from openList and add it to close list
			closeList.push(_.cloneDeep(minNode));
			if (minNode.current.x == targetTilePosition.x && minNode.current.y == targetTilePosition.y) { // break when the goal is found, push it to tempPath for return
				tempPath.push(_.cloneDeep(targetTilePosition));
				break;
			}
			for (let i = 0; i < 4; i++) {
				let newPosition = _.cloneDeep(minNode.current);
				switch (i) {
					case 0: // right
						newPosition.x += 1;
						if (newPosition.x >= mapData.width) {
							continue;
						}
						break;
					case 1: // left
						newPosition.x -= 1;
						if (newPosition.x < 0) {
							continue;
						}
						break;
					case 2: // top
						newPosition.y -= 1;
						if (newPosition.y < 0) {
							continue;
						}
						break;
					case 3: // bottom
						newPosition.y += 1;
						if (newPosition.y >= mapData.height) {
							continue;
						}
						break;
				}
				if (wallMap[newPosition.x + newPosition.y * mapData.width] == 0) {
					// 10 to 1 A* heuristic for node with distance that closer to the goal
					let heuristic = 10;
					let nodeFound = false; // initialize nodeFound for looping (checking the existance of a node)
					// cached distance values for calculating the euclidean distance
					let a = newPosition.x - targetTilePosition.x;
					let b = newPosition.y - targetTilePosition.y;
					let c = minNode.current.x - targetTilePosition.x;
					let d = minNode.current.y - targetTilePosition.y;
					// In case the euclidean distance to targetTilePosition from the newPosition is smaller than the minNodePosition, reduce the heuristic value (so it tend to choose this node)
					if (Math.sqrt(a * a + b * b) < Math.sqrt(c * c + d * d)) {
						heuristic = 1;
					}
					for (let k = 0; k < 3; k++) {
						if (!nodeFound) { // Idea: In open list already ? Update it : In close list already ? Neglect, already reviewed : put it inside openList for evaluation 
							switch (k) {
								case 0: // first check if the node exist in open list (if true, update it)
									for (let j = 0; j < openList.length; j++)
									{
										if (newPosition.x == openList[j].current.x && newPosition.y == openList[j].current.y) {
											if (minNode.totalHeuristic + heuristic < openList[j].totalHeuristic) {
												openList[j] = _.cloneDeep({current: newPosition, parent: minNode.current, totalHeuristic: minNode.totalHeuristic + heuristic});
											}
											nodeFound = true;
											break;
										}
									}
									break;
								case 1: // then check if the node exist in the close list (if true, neglect)
									for (let j = 0; j < closeList.length; j++)
									{
										if (newPosition.x == closeList[j].current.x && newPosition.y == closeList[j].current.y) {
											nodeFound = true;
											break;
										}
									}
									break;
								case 2: // finally push it to open list if it does not exist
									openList.push(_.cloneDeep({current: newPosition, parent: minNode.current, totalHeuristic: minNode.totalHeuristic + heuristic}));
									break;
							}
						} else break;
					}
				}
			}
		}
		if (tempPath.length == 0) { // goal is unreachable
			return [];
		} else {
			while (tempPath[tempPath.length - 1].x != unitTilePosition.x || tempPath[tempPath.length - 1].y != unitTilePosition.y) { // retrieve the path
				for (let i = 0; i < closeList.length; i++) {
					if (tempPath[tempPath.length - 1].x == closeList[i].current.x && tempPath[tempPath.length - 1].y == closeList[i].current.y) {
						tempPath.push(_.cloneDeep(closeList[i].parent)); // keep pushing the parent node of the node, until it reach the start node from goal node
						break;
					}
				}
			}
			tempPath.pop(); // omit start tile, no need to step on it again as we are on it already
			return tempPath;
		}
	},

	setTargetUnit: function (unit) {
		// can't target self!
		if (unit == this._entity)
			return;

		var previousTargetUnit = this.getTargetUnit();

		// remove this unit from currently targeted unit's unitsTargetingMe array.
		if (previousTargetUnit && unit != previousTargetUnit) {
			for (var i = 0; i < previousTargetUnit.ai.unitsTargetingMe.length; i++) {
				if (previousTargetUnit.ai.unitsTargetingMe[i] == this._entity.id()) {
					previousTargetUnit.ai.unitsTargetingMe.splice(i, 1);
				}
			}
		}

		if (unit) {
			// register this unit into new target unit's unitsTargetingMe array.
			if (!unit.ai.unitsTargetingMe.includes(this._entity.id())) {
				unit.ai.unitsTargetingMe.push(this._entity.id());
			}
			this.targetUnitId = unit.id();
		}
	},

	setTargetPosition: function (x, y) {
		this.targetPosition = { x: x, y: y };
	},

	update: function () {

		var self = this;
		var unit = self._entity;

		if (!unit._stats.aiEnabled)
			return;

		let mapData;
		if (this.pathFindingMethod == 'a*') { // only cache mapData if using a* as pathfinding
			mapData = taro.map.data;
		}

		var targetUnit = this.getTargetUnit();

		// update unit's direction toward its target
		var targetPosition = self.getTargetPosition();
		// wandering units should move in straight direction. no need to re-assign angleToTarget
		if (targetPosition && self.currentAction != 'wander') {
			unit.angleToTarget = self.getAngleToTarget();
		}

		// if fleeing, then move to opposite direction from its target
		if (self.currentAction == 'flee') {
			if (unit.angleToTarget)
				unit.angleToTarget += Math.PI;
		}

		switch (self.currentAction) {
			case 'idle':
				// wandering unit will repeat between moving to a random position every 2~4 seconds, then stop for 2~4 seconds
				if (self.idleBehaviour == 'wander' && taro._currentTime > self.nextMoveAt) {
					// assign a random destination within 25px radius
					if (unit.isMoving == false) {
						unit.angleToTarget = Math.random() * Math.PI * 2;
						unit.startMoving();
						self.nextMoveAt = taro._currentTime + 1500 + Math.floor(Math.random() * 1500);
					} else {
						unit.stopMoving();
						self.nextMoveAt = taro._currentTime + 2000 + Math.floor(Math.random() * 2000);
					}
				}
				break;

			case 'move':
				if (this.getDistanceToTarget() < 10) {
					switch (this.pathFindingMethod) {
						case 'simple':
							self.goIdle();
							break;
						case 'a*':
							this.path.pop();
							if (this.path.length > 0) { // Move to the highest index of path saved (closest node to start node)
								this.setTargetPosition(this.path[this.path.length - 1].x * mapData.tilewidth + mapData.tilewidth / 2, this.path[this.path.length - 1].y * mapData.tilewidth + mapData.tilewidth / 2);
							} else {
								self.goIdle();
							}
							break;
					}
				}
				break;

			case 'fight':
				if (targetUnit && unit) {
					var a = self.previousPosition.x - unit._translate.x;
					var b = self.previousPosition.y - unit._translate.y;
					var distanceTravelled = Math.sqrt(a * a + b * b);
					// we've chased far enough. stop fighting and return to where i was before
					if (!isNaN(parseInt(self.maxTravelDistance)) && distanceTravelled > self.maxTravelDistance) {
						self.moveToTargetPosition(self.previousPosition.x, self.previousPosition.y);
					} else if (!isNaN(parseInt(self.letGoDistance)) && this.getDistanceToTarget() > self.letGoDistance) { // if the target is far away from the unit, stop the chase
						self.goIdle();
					} else {
						// stop moving, start attacking if my attack can reach the target
						if (self.maxAttackRange > this.getDistanceToTarget()) {
							unit.isMoving = false;
							unit.ability.startUsingItem();
						} else if (!unit.isMoving) {
							// target's too far. stop firing, and start chasing
							unit.ability.stopUsingItem();
							unit.startMoving();
							if (unit.sensor) {
								unit.sensor.updateBody(); // re-detect nearby units
							}
						} else {
							if (this.pathFindingMethod == 'a*') {
								if (this.path.length <= 0) {
									this.setTargetPosition(targetUnit._translate.x, targetUnit._translate.y); // target the targetUnit if no more path or path failed to generate
								} else {
									let a = this.path[this.path.length - 1].x * mapData.tilewidth - unit._translate.x;
									let b = this.path[this.path.length - 1].y * mapData.tilewidth - unit._translate.y;
									if (Math.sqrt(a * a + b * b) < mapData.tilewidth / 2) { // Euclidean distance is smaller than half of the tile
										this.path.pop();
										if (this.path.length > 0) { // select next node to go
											this.setTargetPosition(this.path[this.path.length - 1].x * mapData.tilewidth + mapData.tilewidth / 2, this.path[this.path.length - 1].y * mapData.tilewidth + mapData.tilewidth / 2);
										}
									}
								}
							}
						}
					}
				} else { // target unit doesn't exist. go back to what I was doing before
					// if I previously had a destination I was heading, then continue the journey
					if (self.targetPosition) {
						self.moveToTargetPosition(self.targetPosition.x, self.targetPosition.y);
					} else { // otherwise go idle
						self.goIdle();
					}
				}
				break;

			case 'flee':
				if (this.pathFindingMethod == 'a*') {
					this.setTargetPosition(unit._translate.x + (targetUnit._translate.x - unit._translate.x), unit._translate.y + (targetUnit._translate.y - unit._translate.y)); // manually assign target position
				}
				if (targetUnit) {
					var a = self.previousPosition.x - targetUnit._translate.x;
					var b = self.previousPosition.y - targetUnit._translate.y;
					var distanceTravelled = Math.sqrt(a * a + b * b);
					// we've ran far enough OR we've been running for long enough (5-10s) let's stop running
					if (distanceTravelled > self.maxTravelDistance || taro._currentTime > self.nextMoveAt) {
						self.goIdle();
					}
				} else { // target unit doesn't exist. stop fleeing.
					self.goIdle();
				}
				break;
		}
	}

});

if (typeof (module) !== 'undefined' && typeof (module.exports) !== 'undefined') {
	module.exports = AIComponent;
}
