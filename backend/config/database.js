const mongoose = require('mongoose');
require('dotenv').config();

exports.connect = () => {
    mongoose.connect(process.env.MONGO_URI,{
        useNewUrlParser: true,
        useUnifiedTopology: true,
    })
    .then(()=>{
        console.log("DB Connection successfully!");
    })
    .catch((error) => {
        console.log("Issue In DB Connection");
        console.error(error);
        process.exit(1);
    });
};