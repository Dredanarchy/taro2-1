showMiniMap = false;
showAllLayers = false;
curLayerPainting = 'floor';
let mouseIsDown = false;
// be very careful with arrow functions.
// arrow functions on these callbacks break mouse input

$(document).mousedown(function() {
	mouseIsDown = true;
}).mouseup(function() {
	mouseIsDown = false;
});

// explain this
const USE_LOCAL_STORAGE = (() => {
	try {
		return !!localStorage.getItem;
	} catch(e) {
		return false;
	}
})();

	storage = {
		// running locally, these are the only ones that appear
		sound: 'on',
		'sound-volume': 100,
		music: 'on',
		'music-volume': 100,
		'force-canvas': false,
	};


const statsPanels = {}; // will we need this?

const Client = TaroEventingClass.extend({
	classId: 'Client',

	init: function() {

		this.data = [];
		this.host = window.isStandalone ? 'https://www.modd.io' : '';

		console.log('window.location.hostname: ', window.location.hostname); // unnecessary

		if (window.location.hostname == 'localhost') taro.env = 'local';

		this.entityUpdateQueue = {};
		this.errorLogs = [];

		pathArray = window.location.href.split('/');

		$('coin-icon').append(
			$('<img/>', {
				src: `${this.host}/assets/images/coin.svg`,
				width: 32,
				height: 32
			})
		);

		this.taroEngineStarted = $.Deferred();
		this.physicsConfigLoaded = $.Deferred();
		this.mapLoaded = $.Deferred();
		this.rendererLoaded = $.Deferred();

		this.mapRenderEnabled = true; // check where we use this
		this.unitRenderEnabled = true; // check where we use this
		this.itemRenderEnabled = true; // Item.prototype.tick()
		this.uiEntityRenderEnabled = true; // check where we use this

		this.clearEveryFrame = true;
		this.cameraEnabled = true;
		this.viewportClippingEnabled = true;

		this.extrapolation = false; //old comment => 'disabling due to item bug'
		this.resolution = 0; //old comment => 'autosize'
		this.scaleMode = 0; //old comment => 'none'
		this.isActiveTab = true;

		this.isZooming = false;

		this._trackTranslateSmoothing = 15;
		this.inactiveTabEntityStream = [];
		this.eventLog = [];

		this.servers = [
			{
				ip: '127.0.0.1',
				port: 2001,
				playerCount: 0,
				maxPlayers: 32,
				acceptingPlayers: true,
				gameId: gameId,
				url: 'ws://localhost:2001'
			}
		];

		// can we just comment this out
		this.tradeOffers = [undefined, undefined, undefined, undefined, undefined];

		// add utility
		this.implement(ClientNetworkEvents);


		$('#dev-error-button').on('click', () => {
			$('#error-log-modal').modal('show');
		});

		$('#bandwidth-usage').on('click', () => { // maybe we could rename 'bandwidth-usage'
			$('#dev-status-modal').modal('show');
		});

		$('#leaderboard-link').on('click', (e) => {
			$('leaderboard-modal').modal('show');
		});

		document.addEventListener('visibilitychange', () => { //this should not be changed to jQ.on()
			//old comment => 'apply entities' merged stats saved during inactive tab
			if (!document.hidden) {
				this.applyInactiveTabEntityStream();
			}

			this.isActiveTab = !document.hidden;
		});

		//go fetch

		taro.addComponent(GameComponent);
		taro.addComponent(MenuUiComponent);
		// we're going to try and insert the fetch here
		let promise = new Promise((resolve, reject) => {
			// if the gameJson is available as a global object, use it instead of sending another ajax request
			if (window.gameJson) {
				resolve(window.gameJson);
			} else if (gameId && !window.isStandalone) {
				$.ajax({
					url: `${this.host}/api/game-client/${gameId}`,
					dataType: 'json',
					type: 'GET',
					success: (game) => {
						resolve(game);
					}
				});
			} else {
				$.ajax({
					url: '/src/game.json',
					dataType: 'json',
					type: 'GET',
					success: (game) => {

						const data = { data: {} };

						game.defaultData = game;

						for (let [key, value] of Object.entries(game)) {
							data['data'][key] = value;
						}

						for (let [key, value] of Object.entries(game.data)) {

							data['data'][key] = value;
						}

						resolve(data);

					}
				});
			}
		});

		promise.then((game) => {
			taro.game.data = game.data;
			taro.addComponent(TaroInputComponent);

			taro.entitiesToRender = new EntitiesToRender();
			taro.renderer = new PhaserRenderer();
			taro.developerMode = new DeveloperMode();

			if(!window.isStandalone){
				this.servers = this.getServersArray();
			}

			// add components to taro instance
			// old comment => 'components required for client-side game logic'
			taro.addComponent(TaroNetIoComponent);
			taro.addComponent(SoundComponent);
			taro.addComponent(TradeUiComponent); // could we comment this one out?

			if (taro.isMobile) {
				taro.addComponent(MobileControlsComponent);
			}

			this.configureEngine();

		})
		.catch((err) => {
			console.error(err);
		});

		// these were under separate conditionals before. idk why.
		if (mode == 'play') {
			$('#game-div canvas').click(() => {
				$('#more-games').removeClass('slideup-menu-animation').addClass('slidedown-menu-animation');
			});

			setTimeout(() => {
				// console.log('loading removed'); // not necessary in production
				$('#loading-container').addClass('slider-out');
			}, 2000);

			// let's try getting our server here
			//
			// if our url vars contained a serverId we are adding it to params
			// ADDING check for engine start resolved
			$.when(this.taroEngineStarted).done(() => {

				const params = this.getUrlVars();
				this.serverFound = false;

				if (!window.isStandalone) {

					this.servers = this.getServersArray();
				}
				// undefined if our params did not have a serverId
				this.preSelectedServerId = params.serverId;

				if (this.preSelectedServerId) {
					//
					for (let serverObj of this.servers) {

						// old comment => 'preselected server found! (via direct url)'
						if (serverObj.id == this.preSelectedServerId) {

							console.log('pre-selected server found. connecting...'); // prod console log

							this.serverFound = true;
							this.server = serverObj;
							break;
						}
					}
				}

				if (!this.server) {

					// if we didn't provide server, we search for the best one
					const bestServer = this.getBestServer();

					if (bestServer) {

						this.server = bestServer;
						this.serverFound = true;
					}
				}

				$('#server-list').val(this.server.id);
				// console.log(`best server selected: ${this.server, this.server.id}`);
			});
		}
	},

	loadPhysics: function() {
		// this will be empty string in data if no client-side physics

		const clientPhysicsEngine = taro.game.data.defaultData.clientPhysicsEngine;
		const serverPhysicsEngine = taro.game.data.defaultData.physicsEngine;

		if (clientPhysicsEngine) {

			taro.addComponent(PhysicsComponent)
				.physics.sleep(true);

		}

		this.physicsConfigLoaded.resolve();
	},

	 loadMap: function() {
		//we need the contents of physicsConfig to progress
		taro.addComponent(MapComponent);
		taro.addComponent(RegionManager);

		taro.menuUi.clipImageForShop();
		taro.scaleMap(taro.game.data.map);

		taro.map.load(taro.game.data.map);
	},

	// new language for old 'initEngine' method
	//
	configureEngine: function() {
		// let's make it easier by assigning the game data to a variable
		const gameData = taro.game.data;

		if (!gameData.isDeveloper) { // .isDeveloper property seems to be outdated

			gameData.isDeveloper = window.isStandalone;
		}

		this.loadPhysics();

		$.when(this.physicsConfigLoaded).done(() => {
			this.startTaroEngine();

			this.loadMap();

			if (taro.physics) {
				// old comment => 'always enable CSP'
				this.loadCSP();
			}

			if(gameData.isDeveloper) {

				taro.addComponent(DevConsoleComponent);
			}


		});

		//this doesn't depend on physics config
		if (gameData.isDeveloper) {

			$('#mod-this-game-menu-item').removeClass('d-none');
		}

		//don't think these depend on physcis
		taro.menuUi.toggleScoreBoard();
		taro.menuUi.toggleLeaderBoard();

		// this is viewport stuff
		// doing these with this.taroEngineStarted.done()
		// we can move the Deferred for mapLoaded to before engine start

		$.when(this.taroEngineStarted, this.mapLoaded, this.rendererLoaded).done(() => {

			// old comment => 'center camera while loading'
			const tileWidth = taro.scaleMapDetails.tileWidth;
			const tileHeight = taro.scaleMapDetails.tileHeight;
			const params = this.getUrlVars();

			taro.client.vp1.camera.translateTo(
				(taro.map.data.width * tileWidth) / 2,
				(taro.map.data.height * tileHeight) /2,
				0
			);

			taro.addComponent(AdComponent);

			let zoom = 1000;

			if (
				gameData.settings.camera &&
				gameData.settings.camera.zoom &&
				gameData.settings.camera.zoom.default
			) {
				zoom = gameData.settings.camera.zoom.default;
				this._trackTranslateSmoothing = gameData.settings.camera.trackingDelay || 15;
			}

			this.setZoom(zoom);

			taro.addComponent(TimerComponent)
				.addComponent(ThemeComponent)
				.addComponent(PlayerUiComponent)
				.addComponent(UnitUiComponent)
				.addComponent(ItemUiComponent)
				.addComponent(ScoreboardComponent)
				// old comment => 'game data is needed to populate shop
				.addComponent(ShopComponent);

			taro.shop.enableShop();

			//old comments => 'load sound and music when game starts'
			taro.sound.preLoadSound();
			taro.sound.preLoadMusic();

			window.activatePlayGame = true; // is there a reason this line was repeated?

			$('#play-game-button-wrapper').removeClass('d-none-important');
			$('.modal-videochat-backdrop, .modal-videochat').removeClass('d-none'); // hmmm
			$('.modal-videochat').show(); // no...yes?

			$('.modal-step-link[data-step=2]').click(); // ok this is going to have to be explained

			if (
				this.preSelectedServerId &&
				this.serverFound &&
				params.joinGame == 'true' &&
				userId
			) {
				window.playButtonClick.dispatchEvent(new Event('click'));
			}
		});

	},

	startTaroEngine: function() {

		taro.start((success) => {

			if (success) {

				this.rootScene = new TaroScene2d()
					.id('rootScene')
					.drawBounds(false);

				this.minimapScene = new TaroScene2d()
					.id('minimapScene')
					.drawBounds(false);

				this.tilesheetScene = new TaroScene2d()
					.id('tilesheetScene')
					.drawBounds(true)
					.drawMouse(true);

				this.mainScene = new TaroScene2d()
					.id('baseScene') // torturing me with the naming
					.mount(this.rootScene)
					.drawMouse(true);

				this.objectScene = new TaroScene2d()
					.id('objectScene')
					.mount(this.mainScene);

				// moving this up here so we can give sandbox the map pan component below
				this.vp1 = new TaroViewport()
					.id('vp1')
					.autoSize(true)
					.scene(this.rootScene)
					.drawBounds(false)
					.mount(taro);

				// moved this down here
				taro._selectedViewport = this.vp1;

				this.taroEngineStarted.resolve();
			}
		});
	},

	getServersArray: function() {
		const serversList = [];
		let serverOptions = $('#server-list > option').toArray(); // could this be const? idk jQ

		serverOptions.forEach((serverOption) => {
			let server = {
				playerCount: parseInt($(serverOption).attr('player-count')),
				maxPlayers: parseInt($(serverOption).attr('max-players')),
				owner: $(serverOption).attr('owner'),
				url: $(serverOption).attr('data-url'),
				gameId: gameId,
				id: $(serverOption).attr('value'),
				name: $(serverOption).attr('data-name')
			};

			serversList.push(server);
		});

		return serversList;
	},
	// we never call this inside Client with a parameter. I assume its an array?
	//
	getBestServer: function(ignoreServerIds) {
		let firstChoice = null; // old comment => 'server which has max players and is under 80% capacity
		let secondChoice = null;

		const validServers = this.servers.filter((server) => {
			return !ignoreServerIds || ignoreServerIds.indexOf(server.id) == -1;
		});

		// old comment => 'max number of players for a server which is under 80% of its capacity
		const overloadCriteria = 0.8;
		let maxPlayersInUnderLoadedServer = 0;
		let minPlayerCount = Number.MAX_SAFE_INTEGER; // ok this seems really unnecessary

		for (let server of validServers) {
			const capacity = server.playerCount / server.maxPlayers;

			if (capacity < overloadCriteria && server.playerCount > maxPlayersInUnderLoadedServer) {
				firstChoice = server;
				maxPlayersInUnderLoadedServer = server.playerCount;
			}

			if (server.playerCount < minPlayerCount) {
				secondChoice = server;
				minPlayerCount = server.playerCount;
			}
		}

		return firstChoice || secondChoice;
	},

	setZoom: function(zoom) {
		this.zoom = zoom;
		if (taro.developerMode.active && taro.developerMode.activeTab !== 'play') {

		} else {
			this.emit('zoom', zoom);
		}
	},

	connectToServer: function() {
		// if typeof args[1] == 'function', callback(args[0])
		taro.network.start(taro.client.server, (clientServer) => { // changed param from 'data' to clientServer

			for (let serverObj of taro.client.servers) {
				if (serverObj.id == clientServer.id) {
					taro.client.server = serverObj;
					break;
				}
			}

			if (taro.client.server) {

				const serverIP = taro.client.server.url.split('://')[1];

				if (serverIP) {

					const serverName = taro.client.server.name || serverIP.split('.')[0];

					if (serverName) {
						$('#server-text').text(`to ${serverName}`);
					}
				}
			}

			$('#loading-container').addClass('slider-out');

			console.log('connected to ', taro.client.server.url, 'clientId ', taro.network.id()); // idk if this needs to be in production

			taro.client.defineNetworkEvents();

			taro.network.send('taroChatJoinRoom', '1');

			taro.addComponent(TaroChatComponent);
			taro.addComponent(VideoChatComponent); // shall we talk about the elephant in the room?

			// old comment => 'check for all of the existing entities in the game
			taro.network.addComponent(TaroStreamComponent);

			// old comment => 'create a listener that will fire whenever an entity is created because of the incoming stream data'
			taro.network.stream.on('entityCreated', (entity) => {

				if (entity._category == 'player') {
					// old comment => 'apply skin to all units owned by this player'
					const player = entity;

					// assign those units' owner as this player
					const units = player.getUnits();
					for (let unitId in units) {
						units[unitId].setOwnerPlayer(player.id());
					}

					if (player._stats.controlledBy == 'human') {
						// old comment => 'if the player is me'
						if (player._stats.clientId == taro.network.id()) {
							taro.client.playerJoinedAt = taro._currentTime;
							taro.client.eventLog.push([
								taro._currentTime - taro.client.playerJoinedAt,
								'My player created'
							]);
							// old comment => 'declare my player'
							taro.client.myPlayer = player;

							if (typeof startVideoChat == 'function') {
								// the elephant is back
								startVideoChat(player.id());
							}

							player.redrawUnits(['nameLabel']);
						}


						if (player._stats && player._stats.selectedUnitId) {
							const unit = taro.$(player._stats.selectedUnitId);
							if (unit) {
								unit.equipSkin();
							}
						}

						if (taro.game.data.isDeveloper ||
							(taro.client.myPlayer &&
								taro.client.myPlayer._stats.isUserMod)
						) {
							taro.menuUi.kickPlayerFromGame(); // we should rename this method
						}
					}
				}
			});

			taro.network.stream.on('entityDestroyed', (entityBeingDestroyed) => { // renamed param from 'unitBeingDestroyed' to 'entityBeingDestroyed'

				if (entityBeingDestroyed._category == 'unit') {
					entityBeingDestroyed.remove();

				} else if (
					(
						taro.game.data.isDeveloper ||
						(
							taro.client.myPlayer &&
							taro.client.myPlayer._stats.isUserMod
						)
					) &&
					entityBeingDestroyed._category == 'player'
				) {
					taro.menuUi.kickPlayerFromGame(entityBeingDestroyed.id()); // this is inside the 'Moderate' menu
				} else {
					try {
						entityBeingDestroyed.remove();
					} catch (e) {
						console.log('* ERROR * trying to destroy entity\n', e);
					}
				}
			});

			const params = taro.client.getUrlVars();

			taro.game.start();
			taro.menuUi.playGame();

			if (params.guestmode == 'on') { // i removed 'this params.joinGame == 'true' || ' from the condition
				// old comment => 'hide menu and skin shop button'
				taro.client.guestmode = true;
				$('.open-menu-button').hide();
				$('.open-modd-shop-button').hide();
			}

			if (window.isStandalone) {

				$('#toggle-dev-panels').show();
			}
		});
	},

	//This method should be looked at...
	//
	loadCSP: function() {

		taro.game.cspEnabled = !!taro.game.data.defaultData.clientSidePredictionEnabled;
		const gravity = taro.game.data.settings.gravity;

		if (gravity) {

			console.log('setting gravity: ', gravity); // not in prod please
			taro.physics.gravity(gravity.x, gravity.y);
		}
		if (taro.physics.engine == 'CRASH') {
			taro.physics.addBorders();
		}
		taro.physics.createWorld();
		taro.physics.start();
		taro.raycaster = new Raycaster();

	},

	// not much here except definitions
	defineNetworkEvents: function () {
		//
		taro.network.define('makePlayerSelectUnit', this._onMakePlayerSelectUnit);
		taro.network.define('makePlayerCameraTrackUnit', this._onMakePlayerCameraTrackUnit);
		taro.network.define('changePlayerCameraPanSpeed', this._onChangePlayerCameraPanSpeed);

		taro.network.define('hideUnitFromPlayer', this._onHideUnitFromPlayer);
		taro.network.define('showUnitFromPlayer', this._onShowUnitFromPlayer);
		taro.network.define('hideUnitNameLabelFromPlayer', this._onHideUnitNameLabelFromPlayer);
		taro.network.define('showUnitNameLabelFromPlayer', this._onShowUnitNameLabelFromPlayer);

		taro.network.define('updateAllEntities', this._onUpdateAllEntities);
		taro.network.define('updateEntityAttribute', this._onUpdateEntityAttribute);

		taro.network.define('updateUiText', this._onUpdateUiText);
		taro.network.define('updateUiTextForTime', this._onUpdateUiTextForTime);

		taro.network.define('alertHighscore', this._onAlertHighscore);

		taro.network.define('item', this._onItem);

		taro.network.define('clientDisconnect', this._onClientDisconnect);

		taro.network.define('ui', this._onUi);
		taro.network.define('playAd', this._onPlayAd);
		taro.network.define('buySkin', this._onBuySkin);
		taro.network.define('videoChat', this._onVideoChat);

		taro.network.define('devLogs', this._onDevLogs);
		taro.network.define('errorLogs', this._onErrorLogs);

		taro.network.define('sound', this._onSound);
		taro.network.define('particle', this._onParticle);
		taro.network.define('camera', this._onCamera);

		taro.network.define('gameSuggestion', this._onGameSuggestion);

		taro.network.define('createFloatingText', this._onCreateFloatingText)

		taro.network.define('openShop', this._onOpenShop);
		taro.network.define('openDialogue', this._onOpenDialogue);
		taro.network.define('closeDialogue', this._onCloseDialogue);

		taro.network.define('userJoinedGame', this._onUserJoinedGame);

		taro.network.define('trade', this._onTrade);

		taro.network.define('editTile', this._onEditTile);
		taro.network.define('editRegion', this._onEditRegion);
		taro.network.define('updateUnit', this._onUpdateUnit);
		taro.network.define('updateItem', this._onUpdateItem);
		taro.network.define('updateProjectile', this._onUpdateProjectile);

		taro.network.define('renderSocketLogs', this._onRenderSocketLogs);
	},

	login: function() {

		console.log('attempting to login'); // no console logs in production.

		$.ajax({
			url: '/login',
			data: {
				username: $('input[name="username"]').val(),
				password: $('input[name="password"]').val()
			},
			dataType: 'json',
			jsonpCallback: 'callback',
			type: 'POST',
			success: (data) => {

				if (data.response == 'success') {

					this.joinGame();

				} else {
					$('#login-error-message').html(data.message).show().fadeOut(7000)
				}
			}
		});
	},

	//
	//i'm not going to change the join game function
	//
	joinGame: function(wasGamePaused = false) {
		
		// if the AdInPlay player is initialised, means the ad blocker is not enabled
		let isAdBlockEnabled = window.isAdBlockEnabled || typeof window?.aiptag?.adplayer === 'undefined';
		const data = {
			number: (Math.floor(Math.random() * 999) + 100) // yeah ok cool, why?
		};

		taro.client.removeOutsideEntities = undefined;
		window.joinedGame = true;

		$('#dev-console').hide();

		if (typeof (userId) != 'undefined' && typeof (sessionId) != 'undefined') {

			data._id = userId;
			data.sessionId = sessionId;
		}

		if (!taro.isMobile) {

			$('.game-ui').show();
		}

		// old comment => 'try loading an ad to find out whether adblocker is active or not
		if (window.isStandalone) {
			isAdBlockEnabled = false;
		}

		// old comment => 'show popover on settings icon for low frame rate'
		if (!taro.isMobile) {

			setTimeout(() => {

				this.lowFPSInterval = setInterval(() => {

					if (this.resolutionQuality != 'low' && taro._renderFPS < 40) { // do we still use this?

						$('#setting').popover('show');
						clearInterval(this.lowFPSInterval);
					}
				}, 60000);
			}, 60000);
		}

		document.addEventListener('click', () => {
			// changed this to addEventListener so we capture the actual event
			$('#setting').popover('hide');
		});

		data.isAdBlockEnabled = !!isAdBlockEnabled;
		
		// send joinGame command only if game was paused and menu was open.
		if (wasGamePaused) {
			taro.network.send('joinGame', data);
		}

		window.joinGameSent.start = Date.now();

		console.log('joinGame sent'); // you already know how I feel about these

		// old comment => 'if game was paused'
		if (!window.playerJoined) {

			taro.client.eventLog.push([
				0,
				`joinGame sent. userId: ${userId}`
			]);
		}
	},

	getUrlVars: function() {
		// old comment => 'edited for play/:gameId'
		const tempGameId = window.location.pathname.split('/')[2];
		const vars = {
			gameId: tempGameId,
		};

		// old comment => 'if serverId is present then add it to vars
		window.location.href.replace(
			/[?&]+([^=&]+)=([^&]*)/gi,
			(m, key, value) => { // not sure about this after looking up .replace()

				vars[key] = value;
			}
		);

		return vars;

	},

	applyInactiveTabEntityStream: function() {
		for (let entityId in this.inactiveTabEntityStream) {
			const entityData = _.cloneDeep(this.inactiveTabEntityStream[entityId]);
			this.inactiveTabEntityStream[entityId] = [];

			const entity = taro.$(entityId);

			if (entity && entityData) {
				entity.streamUpdateData(entityData);
			}
		}
	},

	positionCamera: function(x, y) {
		if (x != undefined && y != undefined) {

			this.emit('stop-follow');
			this.emit('position-camera', [x, y]);
		}
	}
});

if (typeof (module) != 'undefined' && typeof (module.exports) != 'undefined') {
	module.exports = Client;
}
