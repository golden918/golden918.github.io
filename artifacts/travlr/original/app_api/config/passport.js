const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const mongoose = require('mongoose');
const Users = require('../models/user');
const User = mongoose.model('User');

passport.use(
    new LocalStrategy(
        {
            usernameField: 'email'
        },
        async (email, password, done) => {
            const q = await User.findOne({ email: email }).exec();
            if (!q) {
                return done(null, false, {
                    message: 'Incorrect username.'
                });
            }
            if (!q.validPassword(password)) {
                return done(null, false, {
                    message: 'Incorrect password.'
                });
            }
            return done(null, q);
        }
    )
);