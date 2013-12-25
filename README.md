ndbc
====

Simple module to interact with memcache, redis, mysql and mongodb.
I didn't like to write complete queries for MySQL so I started with a small module that allowed me to pass
params and it would format the string for me. Then I needed to cache results in memcache because I wanted
to save on queries, and writing the code after every query was too cumbersome... so I added support for 
memcache into my little db module. Then I started a project using redis and its subscriber and publisher
features, it only made sense to do it inside my pretty little db module. Recently I started a project using
MongoDB and guess what happened? yeah, I added it to this module. 

Be warned though, the features that this module implement are only based on my needs, mostly select 
operations. **It is not complete** for example the mongodb does not support joins (I know mongodb doesn't 
have native joins). I do not claim it to be complete in any way, the mongo end does not have the same 
features as the mysql one either.

A couple of features are not described here although partially implemented.
Partially supported:
	Database joins dont work in mongodb
	Database updates dont work in mongodb

Usage
-----
Initialization:

    var ndbc = require('ndbc');
    var DBCache = new ndbc();
    DBCache.init({
      cache: { port: '6379', host: '127.0.0.1', engine: 'redis'},	
      db: {  port: '27017', host: '127.0.0.1', engine: 'mongodb', database: 'mydb'}
    });
    
The following code generates a cache key based on the specific query, tries to get the data from cache
first, if it finds it then that's what it returns, otherwise it queries the database and then stores it
in cache so the next time that the same 'query' is executed it will get it from cache and not from the db

    DBCache.fetch({
      select: 'field1, field2',
      from: 'collectionOrTable',
      where: 'something > else'
    },
    function(data){
      // do something with the records from data
    });
    
But in some cases I dont want "old" data, and need it fresh from the database, then the nocache param
comes in handy:

    DBCache.fetch({
      select: 'field1, field2',
      from: 'collectionOrTable',
      where: 'something > else',
      nocache: true,
    },
    function(data){
      // do something with the records from data
    });
    
    
Naturally, inserting is sometimes needed:

    DBCache.store('collectionOrTable',{
      field1: 'value1',
      field2: 3234
    }, function(){
      // this code is executed after data has been inserted
    });

We can expire cache entries like this:

    var cacheKey = DBCache.makeCacheKey({select: 'something', from: 'somewhere'});
    DBCache.removeCache(cacheKey);

We can also store in cache directly without storing in the DB:

    DBCache.storeInCache(cacheKey, {something: 'of value'}, function(){
      // this code is executed after storing in cache
    });

This is how we fetch from cache only:

    DBCache.getFromCache(cacheKey, function(data){
      // do something with data
    });

Publisher/Subscriber
--------------------

When the Redis engine is initiated it creates 3 connections to Redis: normal queries, subscriber and publisher.
To subscribe to a channel:

    DBCache.subscribe('channel');

To subscribe to several channels:

    DBCache.subscribe(['channel1', 'channel2']);


To act when a message is received:

    DBCache.cacheOn(function(channel, data){
      // you may want a switch here for the channel...
    });


And if we want to publish something:

    DBCache.publish('channel', {some: 'params'});

Logging
-------
I have my own logging module wrapper and I like to pass its function to my other modules:

    DBCache.init({
      log: myLog.thisIsAFunction,
      cache: { port: '6379', host: '127.0.0.1', engine: 'redis'},	
      db: {  port: '27017', host: '127.0.0.1', engine: 'mongodb', database: 'mydb'}
    });

Events
------
Its useful to know when the database is ready:

    DBCache.on('dbready', function(params){
      console.log(params); // {engine: 'mongodb'}
    });
