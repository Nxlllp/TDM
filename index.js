/**
* Created on 2018-05-21.
*/
"use strict"
const Command = require('command')
const Long = require("long")
const config = require('./config.json')
const manifest = require('./manifest.json')
const logger = require('./logger')
const xmldom = require('xmldom')
var https = require('https');
const fs = require('fs')
const path = require('path')
const ui_install = require('./ui_install')
const UI = require('ui')
const ManagerUi = require('./managerui')
const customCommand = require('./customCommands.json')

String.prototype.clr = function (hexColor) { return `<font color='#${hexColor}'>${this}</font>` }

// slower than Long div
Long.prototype.divTen = function() {
	return this.multiply(0x1999999A).shr(32)
}

Long.prototype.divThousand = function() {
	var stringValue = this.toString()
	return stringValue.substring(0, stringValue.length - 3)
}

module.exports = function DPS(d,ctx) {

	const command = Command(d)
	const ui = UI(d)
	const manager = ManagerUi(d,ctx)
	let enable = config.enable,
	notice = config.notice,
	notice_damage = config.notice_damage,
	debug = config.debug,
	leaving_msg = config.party_leaving_msg,
	bossOnly = config.bossOnly,
	region = config.region

	let mygId,
	myplayerId= '',
	myserverId= '',
	myclass='',
	myname='',
	Boss = new Object(),
	gzoneId = new Array(),
	gmonsterId = new Array(),
	NPCs = new Array(),
	party = new Array(),
	BAMHistory = new Object(),
	lastDps= new Array(),
	currentZone='',
	currentbossId = '',
	missingDamage = new Long(0,0),
	timeout = 0,
	timeoutCounter = 0,
	allUsers = false,
	maxSize = false,
	doc = null,
	odoc = null,
	hideNames = false,
	versionMsg = '',
	classIcon = false,
	sendCommandToUi = new Array(),
	rankSystem = true

	let enable_color = 'E69F00',
	disable_color = '56B4E9'

	if(region === 'EU') region = 'EU-EN'
	let monsterfile = path.join(__dirname, '/monsters-'+ region + '.xml')
	let override = path.join(__dirname, '/monsters-override.xml')

	if (fs.existsSync(path.join(__dirname,'/html/class-icons'))) {
		classIcon = true
	}

	checkUpdate()

	function download(url, dest, cb) {
		var file = fs.createWriteStream(dest);
		var request = https.get(url, function(response) {
			response.pipe(file);
		}).on('error', function(err) { // Handle errors
			fs.unlink(dest); // Delete the file async. (But we don't check the result)
			if (err) throw err
		})

		file.on('finish', function() {
			file.close(cb);
		});

		file.on('error', function (err) {
			fs.unlink(dest);
			console.log(err);
		});
	}

	function downloadRename(url, downloaded, dest, cb) {
		var file = fs.createWriteStream(downloaded);
		var request = https.get(url, function(response) {
			response.pipe(file);
		}).on('error', function(err) {
			fs.unlink(downloaded)
			if (err) throw err
		})
		file.on('finish', function() {
			file.close(cb);
			fs.rename(downloaded, dest, function (err) {
				log('OverWriteFiles :'+  downloaded + ' '+ dest)
				if (err) throw err
			})
		});

		file.on('error', function (err) {
			fs.unlink(downloaded);
			console.log(err);
		});
	}

	function checkUpdate()
	{
		var dest,url
		var rootUrl = `https://raw.githubusercontent.com/xmljson/TDM/master/`
		// check manifest
		var gitkey = 'manifest.json'
		dest = path.join(__dirname,'_' + gitkey)
		url = rootUrl + gitkey
		download(url,dest,getVersionCB)
	}

	function getVersionCB()
	{
		var gitManifest = require('./_manifest.json')
		var currentManifest = require('./manifest.json')
		var gitkey = 'manifest.json'
		var dest = path.join(__dirname,'_' + gitkey)
		//fs.unlink(dest)
		versionMsg = 'TDM version ' + currentManifest.version
		//log(Date.now() + ' ' + currentManifest.version + ' ' + gitManifest.version )
		if(currentManifest.version === gitManifest.version) return
		versionMsg = `Please update new ${gitManifest.version} version.`.clr('FF0000') + '<button class=btn onclick="Update()">Update</button>'
	}

	function update()
	{
		var dest,url
		var rootUrl = `https://raw.githubusercontent.com/xmljson/TDM/master/`
		// check manifest
		var gitkey = 'manifest.json'
		dest = path.join(__dirname,'_' + gitkey)
		url = rootUrl + gitkey
		download(url,dest,checkVersionCB)
	}

	function checkVersionCB()
	{
		var gitManifest = require('./_manifest.json')
		var currentManifest = require('./manifest.json')
		var gitkey = 'manifest.json'
		var dest = path.join(__dirname,'_' + gitkey)
		//fs.unlink(dest)
		versionMsg = 'TDM version ' + currentManifest.version
		log(currentManifest.version + ' ' + gitManifest.version)
		if(currentManifest.version === gitManifest.version) return
		versionMsg = `Downloading new ${gitManifest.version} version.`.clr('FF0000')
		updateFiles()
	}

	function updateFiles()
	{
		var dest,url
		var rootUrl = 'https://raw.githubusercontent.com/xmljson/TDM/master/'
		var result= ''

		var _manifest = require('./_manifest.json')

		for(var key in _manifest.files)
		{
			if(key === 'config.json') continue
			dest = path.join(__dirname,key)
			url = rootUrl + key
			result += `Downloading ${key}<br>`
			downloadRename(url,dest+'.downloaded',dest,null)
		}

		var tmpkey = 'manifest.json'
		dest = path.join(__dirname,tmpkey)
		url = rootUrl + tmpkey
		downloadRename(url,dest+'.downloaded',dest,null)

		log('TDM has been Updated. restart proxy.')
		result += 'TDM has been Updated. restart tera proxy'
		versionMsg = `TDM has been Updated. restart tera proxy.`.clr('FF0000')
		//return result
	}


	if (!fs.existsSync(monsterfile)|| !fs.existsSync(override)) {
		var monsterUrl = `https://raw.githubusercontent.com/neowutran/TeraDpsMeterData/master/monsters/monsters-${region}.xml`
		var monsteroverrideUrl = `https://raw.githubusercontent.com/neowutran/TeraDpsMeterData/master/monsters/monsters-${region}.xml`

		download(monsterUrl,monsterfile,createXmlDoc)
		download(monsteroverrideUrl,override,createXmlODoc)
	}
	else {
		createXmlDoc()
		//createXmlODoc()
	}

	// moster xml file
	const errorHandler = {
		warning(msg) {
			logger.warn({ err: msg }, 'xml parser warning')
		},

		error(msg) {
			logger.error({ err: msg }, 'xml parser error')
		},

		fatalError(msg) {
			logger.error({ err: msg }, 'xml parser fatal error')
		},
	}


	function createXmlDoc() // async
	{
		fs.readFile(monsterfile, "utf-8", function (err,data)
		{
			if (err) {
				return log(err)
			}
			const parser = new xmldom.DOMParser({ errorHandler })
			doc = parser.parseFromString(data, 'text/xml')
			if (!doc) {
				log('ERROR xml doc :' + monsterfile)
				return
			}
			//log(findZoneMonster(152,2003)) //학살의 사브라니악
		})

	}
	function createXmlODoc() // async
	{
		//override.xml
		fs.readFile(override, "utf-8", function (err,data)
		{
			if (err) {
				return log(err)
			}
			const oparser = new xmldom.DOMParser({ errorHandler })
			odoc = oparser.parseFromString(data, 'text/xml')
			if (!odoc) {
				log('ERROR xml odoc :' + override)
				return
			}
		})
	}

	function getNPCInfoFromXml(gId)
	{
		var zone,mon
		var npcIndex = getNPCIndex(gId)
		if (npcIndex < 0) return false

		if (!doc) return false

		try{
			var zone = doc.getElementsByTagName("Zone")
			for(var i in zone)
			{
				if(zone[i].getAttribute("id") == Number(NPCs[npcIndex].huntingZoneId)) {
					NPCs[npcIndex].zoneName = zone[i].getAttribute("name")
					break
				}
			}

			var mon = zone[i].getElementsByTagName("Monster")
			for(var j in mon)
			{
				if(mon[j].getAttribute("id") == Number(NPCs[npcIndex].templateId)) {
					NPCs[npcIndex].npcName = mon[j].getAttribute("name")
					//mon[j].getAttribute("isBoss")==="True" ? NPCs[npcIndex].isBoss = true : NPCs[npcIndex].isBoss = false
					overrideIsBoss(gId)
					break
				}
			}
		}
		catch(err){
			return false
		}
		return true
	}

	// awesomnium web browser UI
	ui.use(UI.static(__dirname + '/html'))
	ui.get(`/api/*`, api.bind(ctx))

	function getData(param) {
		var paramRegex = /(\d*)(\D)/
		var data = param.match(paramRegex)
		data.shift()
		return data
	}

	function textDPSFormat(data)
	{
		var dpsmsg = ''
		dpsmsg += stripOuterHTML(data[0].monsterBattleInfo) + '\n'
		for(var i in data){
			//if(i == 0) continue
			if(data[i].hasOwnProperty('enraged')|| data[i].hasOwnProperty('command')) continue
			if(hideNames) data[i].name='HIDDEN'
			dpsmsg 	+=data[i].name + ' '+ data[i].dps + 'k/s '.clr(enable_color)
			+ data[i].totalDamage.substring(0, data[i].totalDamage.length - 3)  + 'k Damage '.clr(enable_color)
			+ data[i].percentage  + '% Damage '.clr(enable_color)
			+ data[i].crit  + '% Crit '.clr(enable_color) + '\n'
		}
		return dpsmsg
	}

	function sendByEachLine(where,dpsjson)
	{

		let i = 0
		var msg = textDPSFormat(dpsjson)
		let msgs = msg.split('\n'),
		CounterId = setInterval( () => {
			log(msgs)
			if (msgs.length >0) {
				if(typeof where === 'string') d.toServer('C_WHISPER', 1, {"target": where,"message": msgs[0]})
				if(typeof where === 'number') d.toServer('C_CHAT', 1, {"channel":where,"message": msgs[0]})
				msgs.shift()
			} else {
				clearInterval(CounterId)
				CounterId = -1
			}
		}, 1000)
	}

	function api(req, res) {
		const api = getData(req.params[0])
		var req_value = Number(api[0])
		switch(api[1]) {
			case "A":
			notice_damage += 1000000
			if(notice_damage > 20000000) notice_damage = 1000000
			send('Notice damage is ' + numberWithCommas(notice_damage.toString()))
			return res.status(200).json(notice_damage.toString())
			case "B":
			debug = !debug
			statusToChat('Debug mode',debug)
			return res.status(200).json("ok")
			case "C":
			if(req_value == 1 || req_value == 2){
				if(lastDps === '' ) return res.status(200).json('ok')
				sendByEachLine(req_value,lastDps)
				return res.status(200).json('ok')
			}

			if(req_value == 3) return res.status(200).json(customCommand)
			if(req_value == 4){
				var cmd = req.params[0].substring(2, req.params[0].length)
				sendExec(cmd)
				return res.status(200).json('ok')
			}

			case "D":
			notice_damage = req_value
			send('Notice damage is ' + numberWithCommas(notice_damage.toString()))
			return res.status(200).json(notice_damage.toString())
			case "H":
			return res.status(200).json(BAMHistory)
			case "I":
			hideNames = !hideNames
			statusToChat('hideNames',hideNames)
			return res.status(200).json("ok")
			case "J":
			if(!debug) {
				toChat('This button is only for debug mode')
				return res.status(200).json("no")
			}
			sendExec('journal ui')
			return res.status(200).json("ok")
			case "L":
			leaveParty()
			return res.status(200).json('ok')
			case "M":
			if(!debug) {
				toChat('This button is only for debug mode')
				return res.status(200).json("no")
			}
			sendExec('manager')
			return res.status(200).json("ok")
			case "N":
			notice = !notice
			statusToChat('notice damage',notice)
			return res.status(200).json("ok")
			case "O":
			bossOnly = !bossOnly
			statusToChat('boss Only',bossOnly)
			return res.status(200).json("ok")
			case "P":
			enable = false
			statusToChat('dps popup',enable)
			return res.status(200).json("ok")
			case "Q":
			update()
			return res.status(200).json("restart proxy.")
			case "R":
			//reank system
			if(req_value == 2){
				rankSystem = !rankSystem
				statusToChat('rankSystem',rankSystem)
				return res.status(200).json("ok")
			}

			// Refresh DPS window
			// clean previous command
			for(var i in lastDps) {
				if(lastDps[i].hasOwnProperty('command')) {
					lastDps.splice(i,1)
				}
			}
			var dpsdata = membersDps(currentbossId)

			if( sendCommandToUi.length > 0 ) {
				//log('sendCommandToUi.length ' + sendCommandToUi.length)
				for(var i in sendCommandToUi) {
					dpsdata.push(sendCommandToUi[i])
				}
				sendCommandToUi = []
			}
			return res.status(200).json(dpsdata)
			case "S":
			removeAllPartyDPSdata()
			return res.status(200).json('ok')
			case "U":
			if(!debug) {
				toChat('This button is only for debug mode')
				return res.status(200).json("no")
			}
			allUsers = maxSize =  !allUsers
			ui.open()
			statusToChat('Count all dps',allUsers)
			return res.status(200).json("ok")
			case "W":
			var wname = req.params[0].substring(2, req.params[0].length)
			if(wname === '' || lastDps === '' ) return res.status(200).json('ok')
			sendByEachLine(wname,lastDps)
			return res.status(200).json('ok')
			case "X":
			if(!debug) {
				toChat('This button is only for debug mode')
				return res.status(200).json("no")
			}
			sendExec('reload TDM')
			return res.status(200).json("ok")
			case "Y":
			return res.status(200).json(getSettings())
			case "Z":
			if(maxSize) return res.status(200).json('320,700')
			else return res.status(200).json('320,250')
			default:
			return res.status(404).send("404")
		}
	}

	// packet handle
	d.hook('S_LOGIN',10, (e) => {
		party = []
		NPCs = []
		BAMHistory = {}
		mygId=e.gameId.toString()
		myserverId=e.serverId.toString()
		myplayerId=e.playerId.toString()
		myname=e.name.toString()
		//# For players the convention is 1XXYY (X = 1 + race*2 + gender, Y = 1 + class). See C_CREATE_USER
		myclass = Number((e.templateId - 1).toString().slice(-2)).toString()
		putMeInParty()
	})

	d.hook('S_SPAWN_ME',2, (e) => {
		mygId=e.gameId.toString()
		currentbossId = ''
		NPCs = []
		if (!enable) return
		// empty command
		ui.open()
		sendCommandToUi.push({
			"command":"version",
			"argument": versionMsg
		})
	})

	d.hook('S_LOAD_TOPO',3, (e) => {
		currentZone = e.zone
	})

	d.hook('S_ANSWER_INTERACTIVE', 2, (e) => {
		if(debug){
			d.send('C_REQUEST_USER_PAPERDOLL_INFO', 1, {
				name: e.name
			})
		}
	})

	d.hook('S_BOSS_GAGE_INFO',3, (e) => {
		// notified boss before battle
		var id = e.id.toString()
		var hpMax = e.maxHp
		var hpCur = e.curHp
		if(!isBoss(id)) setBoss(id)
		Boss[id].hpPer = Number(hpCur.multiply(100).div(hpMax))
		Boss[id].nextEnrage = (Boss[id].hpPer > 10) ? (Boss[id].hpPer - 10) : 0
	})

	function setBoss(id)
	{
		Boss[id] = {
			"enraged" : false,
			"etimer" : 0,
			"nextEnrage" : 0,
			"hpPer" : 0,
			"estatus" : ''
		}
	}

	function isBoss(id)
	{
		if(typeof Boss[id] === 'undefined') return false
		else return true
	}

	d.hook('S_SPAWN_NPC',8, (e) => {
		var newNPC = {
			'gameId' : e.gameId.toString(),
			'owner' : e.owner.toString(),
			'huntingZoneId' : e.huntingZoneId,
			'templateId' : e.templateId,
			'zoneName' : 'unknown',
			'npcName' : e.npcName,
			//'isBoss' : false,
			'battlestarttime' : 0,
			'battleendtime' : 0,
			'totalPartyDamage' : '0',
			'dpsmsg' : ''
		}
		if(getNPCIndex(e.gameId.toString()) < 0)
		{
			if(NPCs.length >= 50) NPCs.shift()
			NPCs.push(newNPC)
			getNPCInfoFromXml(e.gameId.toString())
		}
	})

	d.hook('S_DESPAWN_NPC',3, (e) => {
		var id = e.gameId.toString()
		var npcIndex = getNPCIndex(id)
		var duration = 0
		if(npcIndex <0) return
		// removing NPC which has battle
		if(NPCs[npcIndex].battlestarttime == 0) {
			NPCs.splice(npcIndex,1)
			//log('NPC removed : '+ NPCs[npcIndex].npcName)
			return
		}
		if(NPCs[npcIndex].battleendtime != 0) return // 길리안 두번

		NPCs[npcIndex].battleendtime = Date.now()
		duration = NPCs[npcIndex].battleendtime - NPCs[npcIndex].battlestarttime

		if(isBoss(id)){
			Boss[id].enraged = false
			Boss[id].etimer = 0
			Boss[id].estatus = ''
		}

		var dpsmsg = membersDps(id)

		// dps history only for boss and non-boss over 1 min
		if(isBoss(id) || duration > 1000 * 60 * 1)
		{
			if(dpsmsg !== '') BAMHistory[id] = dpsmsg

			if(debug) saveDpsData(dpsmsg)

			if(rankSystem) sendDPSData(dpsmsg)
		}

		NPCs[npcIndex].dpsmsg = dpsmsg

		//History limit 10
		if(Object.keys(BAMHistory).length >= 10){
			for(var key in BAMHistory) {
				delete BAMHistory[key]
				break;
			}
		}

		// S_SPAWN_ME clears NPC data
		// S_LEAVE_PARTY clears party and battle infos
	})

	function sendDPSData(data)
	{
		log(data)
		var request = require('request');
		request.post({
			headers: {'content-type': 'application/json'},
			url: 'http://tera.dvcoa.com.au:3000/uploadDps/test',
			form: data
		}, function(error, response, body){
			log(body)
		});
	}

	function saveDpsData(data)
	{
		// save first
		var json = JSON.stringify(data);

		var filename = path.join(__dirname,'history',Date.now()+'.json')

		if (!fs.existsSync(path.join(__dirname,'history'))) fs.mkdirSync(path.join(__dirname,'history'));

		fs.writeFile(filename, json, 'utf8', (err) => {
			// throws an error, you could also catch it here
			if (err) throw err;
			// success case, the file was saved
			log('dps data saved!');
		});

	}


	d.hook('S_NPC_STATUS',1, (e) => {
		if(!isBoss(e.creature.toString())) return
		var id = e.creature.toString()
		var timeoutCounter,timeout
		if (e.enraged === 1 && !Boss[id].enraged) {
			Boss[id].etimer = 36
			setEnragedTime(id,null)
			timeoutCounter = setInterval( () => {
				setEnragedTime(id,timeoutCounter)
			}, 1000)
		} else if (e.enraged === 0 && Boss[id].enraged) {
			if (Boss[id].hpPer === 100) return //??
			Boss[id].etimer = 0
			setEnragedTime(id,timeoutCounter)
			clearInterval(timeoutCounter)
		}
	})

	function setEnragedTime(gId,counter)
	{
		//log(Boss[gId])
		if (Boss[gId].etimer > 0) {
			Boss[gId].enraged = true
			Boss[gId].estatus = 'Boss Enraged'.clr('FF0000') + ' ' + `${Boss[gId].etimer}`.clr('FFFFFF') + ' seconds left'.clr('FF0000')
			Boss[gId].etimer--
		} else {
			clearInterval(counter)
			Boss[gId].etimer = 0
			Boss[gId].enraged = false
			Boss[gId].estatus = 'Next enraged at ' + Boss[gId].nextEnrage.toString().clr('FF0000') + '%'
			if(Boss[gId].nextEnrage == 0) Boss[gId].estatus = ''
		}
	}

	//party handler
	d.hook('S_LEAVE_PARTY_MEMBER',2,(e) => {
		var id = e.playerId.toString()
		for(var i in party){
			if(id===party[i].playerId) party.splice(i,1)
		}
	})

	d.hook('S_LEAVE_PARTY',1, (e) => {
		party = []
		putMeInParty()
	})


	d.hook('S_PARTY_MEMBER_LIST',6,(e) => {
		allUsers = false
		statusToChat('Count all users dps ',allUsers)
		party = []

		e.members.forEach(member => {
			var newPartyMember = {
				'gameId' : member.gameId.toString(),
				'serverId' : member.serverId.toString(),
				'playerId' : member.playerId.toString(),
				'name' : member.name.toString(),
				'class' : member.class.toString()
			}
			if(!isPartyMember(member.gameId.toString())) {
				party.push(newPartyMember)
			}
		})
	})

	d.hook('S_DESPAWN_USER', 3, e => {
		if(!allUsers) return
		var id = e.gameId.toString()
		for(var i in party){
			if(id===party[i].gameId) party.splice(i,1)
		}
	})

	d.hook('S_SPAWN_USER',12, (e) => {
		if(!allUsers) return
		var uclass = Number((e.templateId - 1).toString().slice(-2)).toString()
		var newPartyMember = {
			'gameId' : e.gameId.toString(),
			'playerId' : e.playerId.toString(),
			'name' : e.name.toString(),
			'class' : uclass
		}
		if(!isPartyMember(e.gameId.toString()) ) {
			//if(party.length >= 30) party.shift()
			party.push(newPartyMember)
		}
	})

	function removeAllPartyDPSdata()
	{
		BAMHistory = {}
		lastDps =''
		for(var i in party ){
			for(var key in party[i]) {
				if(key !== 'gameId' && key !== 'playerId' && key !== 'name' && key !== 'class'){
					delete party[i][key]
				}
			}
		}

		for(var key in NPCs){
			NPCs[key].battlestarttime=0
			NPCs[key].battleendtime=0
		}
	}

	function leaveParty()
	{
		if(leaving_msg!=''){
			d.toServer('C_CHAT', 1, {
				"channel": 1,
				"message": leaving_msg
			})
		}
		setTimeout(function(){ d.toServer('C_LEAVE_PARTY', 1, { }) }, 1000);
	}

	function putMeInParty()
	{
		var newPartyMember = {
			'gameId' : mygId,
			'playerId' : myplayerId,
			'serverId' : myserverId,
			'name' : myname,
			'class' : myclass
		}

		if(!isPartyMember(mygId)) {
			party.push(newPartyMember)
		}
	}

	function getIndexOfPetOwner(sid,oid)
	{
		for(var i in party){
			for(var j in NPCs){
				if(NPCs[j].owner===party[i].gameId){
					// pet attack
					if(NPCs[j].gameId===sid) {
						return i
					}
					// pet projectile
					if(NPCs[j].gameId===oid) {
						return i
					}
				}
			}
		}
		return -1
	}

	function getNPCIndex(gId){
		for(var i in NPCs){
			if(gId===NPCs[i].gameId) return i
		}
		return -1
	}

	function isPartyMember(gid){
		for(var i in party){
			if(gid===party[i].gameId) return true
		}
		return false
	}

	function getPartyMemberIndex(id){
		for(var i in party){
			if(id===party[i].gameId) return i
		}
		return -1
	}

	function setCurBoss(gid)
	{
		if(currentbossId === gid) return
		if(bossOnly && !isBoss(gid)) return
		currentbossId = gid
	}
	// damage handler : Core
	d.hook('S_EACH_SKILL_RESULT',d.base.majorPatchVersion < 74 ? 7:9, (e) => {
		// first hit must be myself to set this values
		if(party.length == 0)
		{
			mygId=e.source.toString()
			myplayerId='NODEF'
			myname='_ME'
			//# For players the convention is 1XXYY (X = 1 + race*2 + gender, Y = 1 + class). See C_CREATE_USER
			myclass = Number((e.templateId - 1).toString().slice(-2)).toString()
			log('S_EACH_SKILL_RESULT ' + mygId)
			putMeInParty()
		}

		//log('[DPS] : ' + e.damage + ' target : ' + e.target.toString())

		var memberIndex = getPartyMemberIndex(e.source.toString())
		var sourceId = e.source.toString()
		var target = e.target.toString()
		var skill = e.skill.toString()

		if(e.damage.gt(0)){// && !e.blocked){
			if(memberIndex >= 0){
				// notice damage
				if(mygId===sourceId){
					setCurBoss(target)
					//currentbossId = target
					if(e.damage.gt(notice_damage)) {
						toNotice(noticeDps(memberIndex,e.damage,target))
					}
				}
				// members damage
				if(!addMemberDamage(sourceId,target,e.damage.toString(),e.crit,skill)){
					//log('[DPS] : unhandled members damage ' + e.damage + ' target : ' + target)
				}
			}
			else if(memberIndex < 0){
				// projectile
				var ownerIndex = getPartyMemberIndex(e.owner.toString())
				if(ownerIndex >= 0) {
					var sourceId = e.owner.toString()
					// notice damage
					if(mygId===sourceId){
						setCurBoss(target)
						//currentbossId = target
						if(e.damage.gt(notice_damage)) {
							toNotice(noticeDps(ownerIndex,e.damage,target))
						}
					}
					if(!addMemberDamage(sourceId,target,e.damage.toString(),e.crit,skill)){
						//log('[DPS] : unhandled projectile damage ' + e.damage + ' target : ' + target)
						//log('[DPS] : srcId : ' + sourceId + ' mygId : ' + mygId)
						//log(e)
					}



				}
				else{// pet
					var petIndex=getIndexOfPetOwner(e.source.toString(),e.owner.toString())
					if(petIndex >= 0) {
						var sourceId = party[petIndex].gameId
						// notice damage
						if(mygId===sourceId){
							setCurBoss(target)
							//currentbossId = target
							if(e.damage.gt(notice_damage)) {
								toNotice(noticeDps(petIndex,e.damage,target))
							}
						}
						if(!addMemberDamage(sourceId,target,e.damage.toString(),e.crit,skill)){
							//log('[DPS] : unhandled pet damage ' + e.damage + ' target : ' + target)
							//log('[DPS] : srcId : ' + sourceId + ' mygId : ' + mygId)
							//log(e)
						}



					}
					else{
						//var npcIndex= getNPCIndex(target)
						//if(npcIndex < 0) log('[DPS] : Target is not NPC ' + e.damage + ' target : ' + target)
						//else log('[DPS] : unhandled NPC damage ' + e.damage + ' target : ' + NPCs[npcIndex].npcName)
					}
				}
			}
		}
	})

	function addMemberDamage(id,target,damage,crit,skill)
	{
		//log('addMemberDamage ' + id + ' ' + target + ' ' + damage + ' ' + crit)
		var npcIndex = getNPCIndex(target)
		if(npcIndex <0) return false
		if(NPCs[npcIndex].battlestarttime == 0){
			NPCs[npcIndex].battlestarttime = Date.now()
			NPCs[npcIndex].battleendtime = 0 // 지배석 버그
		}

		NPCs[npcIndex].totalPartyDamage = Long.fromString(NPCs[npcIndex].totalPartyDamage).add(damage).toString()

		for(var i in party){
			if(id===party[i].gameId) {
				//new monster
				if(typeof party[i][target] === 'undefined')
				{
					var critDamage
					if(crit) critDamage = damage
					else critDamage = "0"
					party[i][target] = {
						'battlestarttime' : Date.now(),
						'damage' : damage,
						'critDamage' : critDamage,
						'hit' : 1,
						'crit' : crit
					}

					//log('addMemberDamage true new monster')
					return true
				}
				else {
					party[i][target].damage = Long.fromString(damage).add(party[i][target].damage).toString()
					if(crit) party[i][target].critDamage = Long.fromString(party[i][target].critDamage).add(damage).toString()
					party[i][target].hit += 1
					if(crit) party[i][target].crit +=1
					//log('addMemberDamage true ' + party[i][target].damage)
					return true
				}

				if(debug && mygId === party[i].gameId){
					var skilldata = {
						'skillId' : skill,
						'Time' : Date.now(),
						'damage' : damage,
						'crit' : crit
					}
					//log(skilldata)
					party[i][target].skillLog.push(skilldata)
				}
			}
		}
		//log('addMemberDamage false')
		return false
	}

	function getSettings()
	{
		var settings = {
			"noticeDamage" : notice ? numberWithCommas(notice_damage.toString()).clr(enable_color) : numberWithCommas(notice_damage.toString()).strike().clr(disable_color),
			"notice" : notice ? 'notice'.clr(enable_color) : 'notice'.strike().clr(disable_color),
			"bossOnly" : bossOnly ? 'Boss Only'.clr(enable_color) : 'Boss Only'.strike().clr(disable_color),
			"hideNames" : hideNames ? 'hideNames'.clr(enable_color) : 'hideNames'.strike().clr(disable_color),
			"rankSystem" : rankSystem ? 'rankSystem'.clr(enable_color) : 'rankSystem'.strike().clr(disable_color),
			"allUsers" : allUsers ? 'allUsers'.clr(enable_color) : 'allUsers'.strike().clr(disable_color),
			"debug" : debug ? 'debug'.clr(enable_color) : 'debug'.strike().clr(disable_color),
			"partyLengh" : party.length,
			"NPCsLength" : NPCs.length,
			"BAMHistoryLength" : Object.keys(BAMHistory).length
		}
		return settings
	}

	function membersDps(targetId) // 0 : text,html 2:json
	{
		var endtime = 0
		var dpsmsg = ''
		var bossIndex = -1
		var tdamage = new Long(0,0)
		var dpsJson= []

		if(targetId==='') return lastDps
		var npcIndex = getNPCIndex(targetId)
		if(npcIndex < 0) return lastDps
		if( NPCs[npcIndex].battlestarttime == 0 ) return  lastDps
		if( NPCs[npcIndex].dpsmsg !== '' ) return NPCs[npcIndex].dpsmsg

		var totalPartyDamage = Long.fromString(NPCs[npcIndex].totalPartyDamage)

		endtime=NPCs[npcIndex].battleendtime
		if(endtime == 0) endtime=Date.now()
		var battleduration = endtime-NPCs[npcIndex].battlestarttime
		//log(battleduration +  ' = '+ endtime + ' - '+ NPCs[npcIndex].battlestarttime )

		if (battleduration < 1000) battleduration = 1000
		var battledurationbysec = Math.floor((battleduration) / 1000)

		var minutes = 0
		if(battledurationbysec > 59) minutes = Math.floor(battledurationbysec / 60)
		var seconds = 0
		if(battledurationbysec > 0 ) seconds = Math.floor(battledurationbysec % 60)

		var monsterBattleInfo = NPCs[npcIndex].npcName + ' ' + minutes + ':' + seconds + '</br>'
		monsterBattleInfo = monsterBattleInfo.clr(enable_color)
		if(isBoss(targetId) && Boss[targetId].enraged) monsterBattleInfo = '<img class=enraged />'+monsterBattleInfo

		dpsJson.push({
			"enraged": isBoss(targetId) ? Boss[targetId].estatus : '',
			"etimer": isBoss(targetId) ? Boss[targetId].etimer : 0,
			"monsterBattleInfo" : monsterBattleInfo,
			"huntingZoneId" : NPCs[npcIndex].huntingZoneId,
			"templateId" : NPCs[npcIndex].templateId
		})

		// when party over 10 ppl, only sort at the end of the battle for the perfomance
		//if(party.length < 10 || NPCs[npcIndex].battleendtime != 0)
		party.sort(function(a,b) {
			if(typeof a[targetId] === 'undefined' || typeof b[targetId] === 'undefined') return 0
			if(Long.fromString(a[targetId].damage).gt(b[targetId].damage)) return -1
			else if(Long.fromString(b[targetId].damage).gt(a[targetId].damage)) return 1
			else return 0
		})

		// remove lowest dps member if over 30
		if(allUsers){
			for(;party.length >= 30;) {
				if(party[party.length -1].gameId === mygId) party.splice(party.length -2,1)
				else party.pop()
			}
		}

		var cname
		var dps=0
		var fill_size = 0

		for(var i in party){
			if(totalPartyDamage.equals(0) || battleduration <= 0 || typeof party[i][targetId] === 'undefined') continue
			cname=party[i].name
			if(hideNames) cname='HIDDEN'
			if(party[i].gameId===mygId) cname=cname.clr('00FF00')
			var cimg = ''
			if(classIcon) cimg = '<img class=class' +party[i].class + ' />'
			cname = cname + cimg

			tdamage = Long.fromString(party[i][targetId].damage)
			dps = numberWithCommas(tdamage.div(battledurationbysec).divThousand())
			var percentage = tdamage.multiply(100).div(totalPartyDamage).toString()

			// the smallest gap size from highest damage (sorted)
			if(i==0) fill_size = 100 - percentage

			// add the gap size for each member graph
			var graph_size = percentage //+ fill_size

			var crit
			if(party[i][targetId].crit == 0 || party[i][targetId].hit == 0) crit = 0
			else crit = Math.floor(party[i][targetId].crit * 100 / party[i][targetId].hit)

			dpsJson.push({
				"name": cname,
				"serverId": party[i].serverId,
				"totalDamage":tdamage.toString(),
				"dps":dps,
				"percentage":percentage,
				"crit":crit
			})
		}



		// To display last msg on ui even if boss removed from list by DESPAWN packet
		if(bossOnly && isBoss(targetId) ) lastDps = dpsJson
		if(!bossOnly) lastDps = dpsJson

		//return dpsmsg
		return dpsJson
	}

	function noticeDps(i,damage,targetId)
	{

		var endtime = 0
		var dpsmsg = ''
		var bossIndex = -1
		var tdamage = new Long(0,0)
		var totalPartyDamage  = new Long(0,0)
		var dps=0

		var npcIndex = getNPCIndex(targetId)

		if(npcIndex < 0) return

		if( NPCs[npcIndex].battleendtime == 0) endtime=Date.now()
		else endtime=NPCs[npcIndex].battleendtime
		var battleduration = Math.floor((endtime-NPCs[npcIndex].battlestarttime) / 1000)

		if(battleduration <= 0 || typeof party[i][targetId] === 'undefined'){
			return
		}

		tdamage = Long.fromString(party[i][targetId].damage)
		dps = numberWithCommas(tdamage.div(battleduration).divThousand())
		dpsmsg = numberWithCommas(damage.divThousand()) + ' k '.clr(enable_color) + dps + ' k/s '.clr(enable_color)

		return dpsmsg
	}

	// helper
	function stripOuterHTML(str) {
		return str.replace(/^<[^>]+>|<\/[^>]+><[^\/][^>]*>|<\/[^>]+>$/g, '')
	}

	function numberWithCommas(x) {
		return x.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
	}

	function toChat(msg) {
		if(!msg) return
		send(msg)
	}

	function toNotice(msg) {
		if (notice) d.toClient('S_DUNGEON_EVENT_MESSAGE',1, {
			unk1: 42,
			unk2: 0,
			unk3: 27,
			message: msg
		})
	}

	function send(msg) { command.message(`[DPS] : ` + [...arguments].join('\n  - '.clr('FFFFFF'))) }
	function sendExec(msg) { command.exec([...arguments].join('\n  - '.clr('FFFFFF'))) }

	function log(msg) {
		if(debug) console.log(msg)
	}

	function statusToChat(tag,val)
	{
		send(`${tag} ${val ? 'enabled'.clr(enable_color) : 'disabled'.clr(disable_color)}`)
	}
	// command
	command.add('dps', (arg, arg2,arg3) => {
		// toggle
		if (!arg) {
			enable = true
			statusToChat('dps popup',enable)
		}
		else if (arg == 'u' || arg=='ui') {
			enable = true
			statusToChat('dps popup',enable)
			ui.open()
			sendCommandToUi.push({
				"command":"version",
				"argument": versionMsg
			})
		}
		else if (arg == 'nd' || arg=='notice_damage') {
			notice_damage = arg2
			toChat('notice_damage : ' + notice_damage)
		}
		else if (arg == 't' || arg=='test') {
			sendCommandToUi.push({
				"command":"submit",
				"argument": path.join(__dirname, 'dps_data.json')
			})
		}
		// notice
		else if (arg === 'n' ||  arg === 'notice') {
			notice = !notice
			statusToChat('notice',notice)
		}
		else send(`Invalid argument.`.clr('FF0000') + ' dps or dps u/h/n/s or dps nd 1000000')
	})

	this.destructor = () => {
		command.remove('dps')
		command.remove('manager')
	}
}
