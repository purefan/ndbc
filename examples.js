var ndbc = require("./index.js"),
	ndbc = new ndbc();

var mysql = {
		host: "localhost",
		port: 3306,
		user: "purefan",
		password: "phpfox",
		engine: "mysql",
		database: "test"
	};
var mongodb = {
		host: "localhost",
		port: 27017,
		user: "purefan",
		password: "phpfox",
		engine: "mongodb",
		database: "test"
	};

ndbc.init({
	cache: {
		host: "localhost",
		port: 6379,
		engine: "redis",
		password: null // this is optional
	},
	db: mongodb 
	// log: console.log // this is optional and defaults to null
});

ndbc.once('cacheready', function(data){
	console.log("Cache is ready: " + data.engine);
});

ndbc.once('dbready', function(data){
	console.log("1. DB is ready: " + data.engine, "1.2 Lets insert into the first table");
	// To create a table is not a common task in a program. This feature is intentionally left out.

	// Test inserting a value
	var key_1 = "my first key",
		value_1 = "my first value is " + Math.round(Math.random() * 364728);
	ndbc.store("test_1",
		{
			my_key: key_1,
			my_value: value_1
		},
		function(data){
			console.log("2. Inserted into the first table:", data, " 2.1 Lets insert into the second table");
			// data has the insertId and other information.
			var key_2 = "my second key",
				value_2 = "my second value is random: " + Math.round(Math.random() * 364728);
			ndbc.store("test_2", {
				your_value: value_1,
				your_key: key_1
			}, 
				function(data){
					console.log("3. We have inserted another record in the second table.", "3.1 Lets try a simple select.");
					ndbc.getFromDB({
						select: "*",
						where: "my_key = \"" + key_1 + "\"",
						from: "test_1"
					}, function(data){
						console.log("4. We have selected some records now:", data, "4.1 This is how we join");
						ndbc.getFromDB({
							select: "*",
							join: [{
								from: "test_2",
								as: "t2",
								on: "t2.your_key = t1.my_key"
							}],
							from: ["test_1", "t1"]
						}, function(data){
							console.log("5. This is from our join:", data);
						});
					});
				});
		}
	);
});