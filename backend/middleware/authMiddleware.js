const jwt = require("jsonwebtoken");
const User = require("../models/User");
const assertActiveAccount = (user) => {
  if (user.accountStatus === "disabled") { const error = new Error("This account is disabled"); error.status = 403; throw error; }
};

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Access denied. No token provided.",
    });
  }

  const token = authHeader.split(" ")[1];
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] }); }
  catch { return res.status(401).json({ message: "Invalid or expired token." }); }
  try {
    const userId = decoded.userId || decoded.id;
    const user = await User.findById(userId).select("_id name email phone role isVerified accountStatus doctorVerificationStatus doctorVerificationReason isDoctorVerified +sessionVersion");

    if (!user) {
      return res.status(401).json({ message: "The account for this session no longer exists." });
    }
    if ((decoded.sessionVersion || 0) !== (user.sessionVersion || 0)) return res.status(401).json({ message: "Session revoked. Please sign in again." });
    req.authAccount = user;
    try { assertActiveAccount(user); } catch (error) { return res.status(error.status).json({ message: error.message }); }

    req.user = {
      id: user._id.toString(),
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
      accountStatus: user.accountStatus,
    };

    next();
  } catch (error) {
    // A database outage is not an authentication failure; let the error handler
    // redact it rather than logging users out as if their token were invalid.
    return next(error);
  }
};

module.exports = authMiddleware;
module.exports.assertActiveAccount = assertActiveAccount;
