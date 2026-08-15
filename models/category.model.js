import mongoose from "mongoose";

const categorySchema = new mongoose.Schema({
    title:{type:String},
    description:{type:String},
    img:{type:String},
    matches:[
        {
            date:{type:String},
            title:{type:String},
            prizePool:{type:Number},
            slots:{type:Number},
            entryFee:{type:Number},
            idpTimings:{type:String}
        }
    ]
});

const categoryModel = mongoose.model("Categories", categorySchema);

export default categoryModel;