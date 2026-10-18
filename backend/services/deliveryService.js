const localAdapter = {
  async send() {
    if (process.env.NODE_ENV !== "production") console.info("Development delivery not sent");
    return { delivered: false, adapter: "local" };
  },
};

const deliver = async (payload) => localAdapter.send(payload);
module.exports = { deliver };
