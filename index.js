var oRedis = require('redis');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var mongo = require('mongodb');


/**
*	This module connects to Redis, MySQL, Memcache and MongoDB

	function setLog(<function>log)		
		Receives a logging function. Should accept variable parameters; Optional, it uses console.log otherwise;
		
	function initCache(<int>port, <string>host, <string>engine)
		Connects and instantiates a caching mechanism. Redis is the only implemented.
		
	function initDB(<object>params)
		params must include host, user, password. @see mysql
		
	function store(<string>table, <object> params, <function> callback)
		Stores in the database AND in cache unless the param nocache is set to true. Example:
		store('table_name', { column1 : 'value 1', column2: 232}, function(data){
			console.log('Inserted with id: ' + data.insertId);
		});
	function getFromCache(<string> key, <function>callback, <function>errcallback)
		errcallback is optional.
		
	function getFromDB (<object> params, <function> callback)
		params is a traditional set of values to get from database. Example:
		getFromDB({ select: '*', from: 'table_example', where: 'something= 1'}, function(data)
		{
			// we can iterate over the results in data
		});
		
		the param from allows a second form to use an alias
			from: ['table_name', 'as']
		
		Joins are possible when placed in an array and engine is mysql, for example:
		getFromDB({
			select: '*',
			from: ['user', 'u']
			join: [
				{ 
					type: 'left',
					from: ['car', 'c'],
					on: 'c.user_id = u.user_id'
				}
			]
		}, function(data){...});
		
		if the param cacheKey is present the results will be stored in cache. To get from cache if available use fetch
	
	function makeCacheKey(<string|object> params)
		Returns a string that can be used to retrieve and store values in cache.
	
	function storeInCache(<string> key, <object|string> data, <function> callback)
		data is stored as a string always, if data is an object its JSON'ed
		
	function fetch(<object> params, <function>callback)
		@see getFromDB. Similar to getFromDB but if the param cacheKey is present it tries to retrieve the value from cache first. 
		Stores the result in cache if the param cacheKey is present.
		if the param nocache is present then it skips all cache related operations.
	
	function updateDB(<object> params, <function> callback)
		@example updateDB({ table: 'table_to_update', fields: { col1: 'new value', col2: 232 }, where: 'user_id = 1', function(data){ ... });
		callback passes the result from the mysql as param
	
	function subscribe(<string> channel, <function> callback)
		Subscribes the Redis client to a specific channel (no patterns) and calls callback when a message is received
		
	function publish( <string> channel, <object> message)
		Publishes a message to Redis.
*/


var NDBC = function(){};

// Let me emit events
util.inherits(NDBC, EventEmitter);

NDBC.prototype.cache = null;
NDBC.prototype.db = null;
NDBC.prototype._log = null;
NDBC.prototype.log = function(){ if(this._log !== null) this._log(arguments); };//for(var i in arguments){console.log(arguments[i]);}};
NDBC.prototype.cacheSubscriptions = {initalized: false};

/**
	params is an object which requires two objects: one for the cache and one for the database. 
	It may also take a param "log" with a function which will receive debugging information
	Example:
		ndbc.init({
			log: function(){ console.log(arguments);},
			cache: {
				port: 11211,
				host: "localhost",
				engine: "redis"
			},
			db: 
		});
*/
NDBC.prototype.init = function(params)
{
	if (typeof params.log != 'undefined')
		this._log = params.log;
	if (typeof params.cache != 'undefined')
		this.initCache( params.cache.port, params.cache.host, params.cache.engine, params.cache.password);
	if (typeof params.db != 'undefined')
		this.initDB( params.db);
};

NDBC.prototype.setLog = function(oLog)
{
	this._log = this.log = oLog;
	oLog('NDBC::setLog', 'Log is Ready'); 
	this.emit('logReady', {}); 
};

NDBC.prototype.testCache = function()
{
	this.log('NDBC::testCache', 'some value', {another:21});
};

NDBC.prototype.initCache = function(port, host, engine, password)
{
	var self = this;
	password = password || false;
	if (engine != 'memcache') engine = 'redis';
	this.cacheEngine = engine;
	if (engine == 'memcache')
	{
		this.cache = new nMemcache.Client( port, host);
		if (this.log !== null)
		{
			this.cache.on('error', function(e){ self.log('initCache', 'Red:Memcache Error', e);});
			this.cache.on('connect', function(){self.log('initCache', 'Green:Connected to Memcached'); self.emit('cacheready', {engine: "Memcached"});});
		}
		this.cache.connect();
	}
	else if (engine == 'redis')
	{
		this.cache = oRedis.createClient(port);
		if (password !== false)	
			this.cache.auth(password);
		this.cache.on('ready', function(){ self.log('Green:DB::initCache', 'Connected to Redis'); self.emit('cacheready', {engine: "Redis"});});
		this.cache.on('error', function(err){ console.log(err);self.log('Red:DB::Redis_Error', err);});
		this.cache.on('end', function(){ self.log('DB::Redis', 'Connection to Redis closed'); });
		
		// Another client to publish messages
		this.cachePublisher = oRedis.createClient(port, host);
		this.cachePublisher.on('ready', function(){ self.log('Green:DB::initCache', 'Publisher connected to Redis');});
		
		if (password !== false)
			this.cachePublisher.auth(password); 
		
		// And another one to subscribe
		this.cacheSubscriber = oRedis.createClient(port, host);
		this.cacheSubscriber.on('ready', function(){ self.log('Green:DB::initCache', 'Subscriber connected to Redis'); });
		if (password !== false)
			this.cacheSubscriber.auth(password); 
	}
};

NDBC.prototype.initDB = function(params)
{
	if (params.engine != 'mysql') params.engine = 'mongodb';
	if (params.engine == 'mysql')this.initMySQL(params);
	else this.initMongo(params);	
		
	this.dbEngine = params.engine;
};

NDBC.prototype.initMongo = function(params)
{
	var self = this;
	params.database = params.database || '';
	this.db = mongo.MongoClient;
	this.db.connect( 'mongodb://' + params.host  + ':' + params.port + '/' + params.database, function(err, db)
	{
		if (!err)
		{
			self.dbObject = db;
			self.log('Green:DB::initDB', 'Connected to MongoDB');
			self.emit('dbready', {engine: 'mongodb'});
		}
	});
};

NDBC.prototype.initMySQL = function(params)
{
	var self = this;
	var oMysql = require("mysql");

	this.db = oMysql.createConnection( params );
	this.db.connect();
	this.db.query('SELECT 1', function(err, results, fields){
		if (err)
		{
			console.error('Red:Could not connect to mysql:');
			console.error(err);
		}
		else
		{
			self.log('DB::initDB','Green:Connected to MySQL');
			self.emit('dbready', {engine: 'Mysql'});
		}
	});
};

NDBC.prototype.store = function(table_name, params, callback)
{
	if (this.dbEngine == 'mongodb')
		this.storeInMongo(table_name, params, callback);
	else
		this.storeInMySQL(table_name, params, callback);
};

NDBC.prototype.storeInMongo = function(table, params, callback)
{
	var self = this;
	
	var collection = this.dbObject.collection(table);
	collection.insert(params, callback);
};

NDBC.prototype.storeInMySQL = function(table_name, params, callback)
{
	var fields = '(', values = 'VALUES (', sql = '';
	
	for (var i in params) 
	{
		fields += i + ', ';
		values += '"' + params[i] + '", ';
	}
	fields = fields.substr(0, fields.length -2) + ')';
	values = values.substr(0, values.length -2) + ')';
	sql = 'INSERT INTO `' + table_name + '` ' + fields + ' ' + values;
	this.db.query(sql, function(err, info){
		if (err !== null)
		{
			console.error('<sql-error>SQL error on: ' + sql + ' Error is: ' + err['message'] + ' </sql-error>');
		}
		else if (typeof callback == 'function')
		{
			callback(info);
		}
	});
};

NDBC.prototype.getFromCache = function(key, callback, errcallback)
{
	this.cache.get(key, function(err, data){
		if (err)
		{
			if (typeof errcallback == 'function') return errcallback(err);
			console.error(err);
		}
		else
		{
			if (typeof data == 'string') data = JSON.parse(data);
			callback(data);
		}
	});
};

NDBC.prototype.getFromDB = function(params, callback)
{
	if (this.dbEngine == 'mysql') this.getFromMySQL(params, callback);
	else this.getFromMongo(params, callback);
};

NDBC.prototype.getFromMongo = function(params, callback)
{
	var self = this;
	this.log('DB::getFromMongo', params);
	if (typeof params.join !== 'undefined')
		throw new Error("Mongo does not implement joins");
	// make sure theres a where
	params['where'] = params['where'] || null;
	params['select'] = params['select'] || [];
	if (typeof params['select'] == 'string')
		params['select'] = params['select'].replace(/ /g,'').split(',');
		
	var collection = this.dbObject.collection(params['from']);	
	
	if (typeof params['limit'] != 'undefined')
		collection.limit(params['limit']);
	
	if (typeof params['sort'] != 'undefined')
		collection.sort(params['sort']);
	
	
	var cursor = collection.find(params['where'], params['select']);
	var documents = [];
	cursor.toArray(function(err, docs)
	{
		if (err) self.log('Red:Error::DB::getFromMongo', err);
		else callback(docs);
	});
};

NDBC.prototype.getFromMySQL = function(params, callback)
{
	var sql = 'SELECT ';
	var self = this;
	
	sql += params['select'] + ' ';
	
	if (typeof params['from'] != 'undefined')
	{
		if (typeof params['from'] == 'string' && params['from'].length > 0) 
			sql += 'FROM ' + params['from'] + ' ';
		else if (typeof params['from'] != 'undefined')
			sql += 'FROM ' + params['from'][0] + ' AS ' + params['from'][1] + ' ';
	}
	
	if (typeof params['join'] != 'undefined')
	{
		for (var i in params['join'])
		{
			sql += typeof params['join'][i]['type'] != 'undefined' ? params['join'][i]['type'] : '';
			sql += ' JOIN ' + params['join'][i]['from'] + ' AS ' + params['join'][i]['as'] + ' ON ' + params['join'][i]['on'] + ' ';
		}
	}
	
	if (typeof params['where'] != 'undefined')
		sql += 'WHERE ' + params['where'] + ' ';
	
	this.db.query(sql, function(err, data)
	{
		if (err){ console.error(err); }
		else
		{
			if (typeof params['cacheKey'] != 'undefined' && data.length > 0)
			{
				self.cache.set( params['cacheKey'], data[0], function(err, data){
					if (err) console.error(err);
				});
			}
			callback(data);
		}
	});
};

NDBC.prototype.makeCacheKey = function(params)
{
	var cacheKey = '';
	for ( var i in params)
	{
		if (typeof params[i] != 'string') cacheKey += this.makeCacheKey(params[i]);
		else cacheKey += i + '' + params[i];
	}
	return cacheKey.replace(/ /g,'')
		.replace(/>/g,'_gt_')
		.replace(/</g, '_lt_')
		.replace(/=/g, '_eq_')
		.replace(/"/g, '_dblquot_')
		.replace(/\*/g, '_star_')
		.replace(/'/g, '_quot_');
};

NDBC.prototype.removeCache = function(cacheKey)
{
	var self = this;
	if (this.cacheEngine == 'redis')
	{
		this.cache.del(cacheKey, function(something){
			self.log('NDBC::removeCache', 'null is good: ', something);
		});
	}
	else
	{
		this.log('Red:Error::NDBC::removeCache', 'Not implemented for memcache');
	}
};

NDBC.prototype.storeInCache = function(key, data, callback)
{
	if (this.cacheEngine == 'redis')
		this.storeInRedis(key, data, callback);
	else
		this.storeInMemcache(key, data, callback);
};

/**
*	In the future we may allow for Redis sets and other types, but for now
*	its fortunate that both memcache and redis implementations use the same
*	name for this function
*/
NDBC.prototype.storeInRedis = function(key, data, callback)
{
	this.storeInMemcache(key, data, callback);
};

NDBC.prototype.storeInMemcache = function(key, data, callback)
{
	if (typeof data != 'string') data = JSON.stringify(data);
	this.cache.set(key, data, function(err, info)
	{
		if (err)
		{
			if (typeof errcallback == 'function') return errcallback(err);
			console.error(err);
		}
		else if (typeof callback == 'function')
		{
			callback(info);
		}
	});
};

NDBC.prototype.fetch = function(params, callback)
{
	var self = this;
	// this.log('DB::fetch', params);
	if (typeof params['nocache'] != 'undefined' && params['nocache'] === true)
	{
		self.getFromDB(params, callback);
	}
	else
	{
		params['cacheKey'] = this.makeCacheKey(params);
		//this.log('DB::fetch', 'cacheKey: ' + params['cacheKey']);
		this.getFromCache(params['cacheKey'], function(data)
		{
			if (data == null || data.indexOf('nil') > (-1)) // empty, doesnt exist
			{
				self.log('DB::fetch', 'Did not get it from cache, trying DB');
				// get it from database
				self.getFromDB(params, function(dbinfo)
				{
					// Once we got it from the database we should store it in cache
					self.storeInCache(params['cacheKey'], dbinfo);
					callback(dbinfo);
				});
			}
			else
			{
				self.log('DB::fetch', 'Got ' + params['cacheKey'].substr(0,10) + '... from Redis');
				
				// It was found in cache so we just trigger the callback
				callback( data );
			}
		});
	}
	return;
	
	
	
};

/**
 *  @TODO split and support mongodb updates
 */
NDBC.prototype.updateDB = function(params, callback)
{
	var sql = 'UPDATE ' + params['table'] + ' SET ';
	
	if (typeof params['fields'] == 'string')
		sql += params['fields'] + ' ';
	else
	{
		for (var i in params['fields'])
			sql += i + ' = ' + params['fields'][i] + ', ';
		sql = sql.substr(0, sql.lastIndexOf(', '));
	}
	
	sql += 'WHERE ' + params['where'];
	
	this.db.query(sql, function(err, data){
		if (err)
		{
			console.error('----------------- ERROR UPDATING DB ----------------');
			console.error(err);
		}
		else if (typeof callback == 'function')
			callback(data);
	});
};

NDBC.prototype.publish = function(channel, message)
{
	if (typeof message != 'string') message = JSON.stringify(message);
	
	this.log('DB::publish', channel + ' <== ' + message);
	this.cachePublisher.publish(channel, message);
};

NDBC.prototype.subscribe = function(channel)
{
	if (Array.isArray(channel))
	{
		var self = this;
		channel.forEach(function(channel){ self.subscribe(channel); });
	}
	else
	{
		this.cacheSubscriber.subscribe(channel);
	}
};

NDBC.prototype.cacheOn = function(callback)
{
	this.cacheSubscriber.on('message', function(channel, message){
		console.log('cacheOn ' + channel); console.log(JSON.parse(message));
		callback(channel, JSON.parse(message));
	});
};

module.exports = NDBC;
