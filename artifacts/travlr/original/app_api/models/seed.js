// Bring in the DB connection and the Trip schema
const mongoose = require('./db');
const Trip = require('./travlr');

// Read the JSON file and parse it into objects
var fs = require('fs');
var trips = JSON.parse(fs.readFileSync('C:\\Users\\Admin\\Downloads\\travlr\\travlr\\CS 465\\data\\trips.json', 'utf8'));

// delete any existing records, then insert seed data
const seedDB = async () => {
    await Trip.deleteMany({});
    await Trip.insertMany(trips);
}

// Close the DB connection when done and exit 
seedDB().then(async () => {
    await mongoose.connection.close();
    process.exit(0);
});