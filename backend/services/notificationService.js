const Notification = require("../models/Notification");
const User = require("../models/User");

const notify = ({ recipient, type, title, message, link = "" }) => Notification.create({ recipient, type, title, message, link });
const recipientFilter = (userId) => ({ recipient: userId });
const notifyAdmins = async ({ type, title, message, link = "/admin/doctors/verification" }) => {
  const admins = await User.find({ role: "admin", accountStatus: { $ne: "disabled" } }).select("_id").lean();
  if (admins.length) await Notification.insertMany(admins.map((admin) => ({ recipient: admin._id, type, title, message, link })));
};
module.exports = { notify, notifyAdmins, recipientFilter };
