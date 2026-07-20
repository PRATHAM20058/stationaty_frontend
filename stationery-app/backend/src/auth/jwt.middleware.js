'use strict';

const jwt = require('jsonwebtoken');

// Verify `Authorization: Bearer <jwt>`. Only real, backend-signed JWTs are accepted — this is
// the trust boundary that keeps one user's data from another's, so unsigned/forged tokens must
// be rejected. Any failure -> 401 (the client logs out on 401). `req.user.id` is the token `sub`.
module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ message: 'Missing or malformed Authorization header' });
  }
  try {
    const decoded = jwt.verify(match[1], process.env.JWT_SECRET);
    // A token with no `sub` has no user to scope data by; reject it rather than letting an
    // `undefined` user id reach the queries (which would surface as a 500, not a clean 401).
    if (!decoded || !decoded.sub) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    req.user = { id: decoded.sub };
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};
