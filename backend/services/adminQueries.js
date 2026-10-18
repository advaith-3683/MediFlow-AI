const { AppError } = require("../middleware/errorHandler");
const pageValues = query => {
  const page = query.page === undefined ? 1 : Number(query.page), limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, "Invalid pagination");
  return { page, limit };
};
const dateRange = query => {
  const range = {};
  for (const [key, operator] of [["dateFrom", "$gte"], ["dateTo", "$lte"]]) {
    if (!query[key]) continue;
    const raw = query[key];
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/.test(raw)) throw new AppError(400, "Invalid date range");
    const date = new Date(raw);
    if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(raw)) throw new AppError(400, "Invalid date range");
    range[operator] = key === "dateTo" && raw.length === 10 ? new Date(date.getTime() + 86400000 - 1) : date;
  }
  if (range.$gte && range.$lte && range.$gte > range.$lte) throw new AppError(400, "Date range is reversed");
  return range;
};
module.exports = { pageValues, dateRange };
