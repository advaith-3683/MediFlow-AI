const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: "You do not have permission to access this resource" });
  }

  next();
};

const requireVerified = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }

  if (!req.user.isVerified) {
    return res.status(403).json({ message: "A verified account is required" });
  }

  next();
};

module.exports = { authorizeRoles, requireVerified };
