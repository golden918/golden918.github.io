const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); // Enable JSON Web Tokens 

// This is where we import the controllers we will route
const tripsController = require('../controllers/trips');
const authenticationController = require('../controllers/authentication');

/**
 * Enhancements
 * - the original called next() unconditionally on the last line,
 * outside the jwt.verify callback, so a request with an invalid token was
 * still passed to the protected controller (and then tried to send a second
 * response). Now next() is only reached after the token verifies. 
 * Every failure path returns 401 and stops. The algorithm is pinned to HS256 so a
 * token cannot pick its own.
 */

const { expressjwt } = require('express-jwt');

function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: 'Authorization header required' });
    }
 
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ message: 'Authorization header must be: Bearer <token>' });
    }
 
    try {
        req.auth = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        return next();
    } catch (err) {
        return res.status(401).json({ message: 'Token validation error' });
    }
}
 
router.post('/register', authenticationController.register);
router.post('/login', authenticationController.login);
 
router
    .route('/trips')
    .get(tripsController.tripsList)
    .post(authenticateJWT, tripsController.tripsAddTrip);
 
// Must be registered before /trips/:tripCode so "stats" is not read as a trip code
router.get('/trips/stats', tripsController.tripsStats);
 
router
    .route('/trips/:tripCode')
    .get(tripsController.tripsFindByCode)
    .put(authenticateJWT, tripsController.tripsUpdateTrip)
    .delete(authenticateJWT, tripsController.tripsDeleteTrip);
 
module.exports = router;
module.exports.authenticateJWT = authenticateJWT;