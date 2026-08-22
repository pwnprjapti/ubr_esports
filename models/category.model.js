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
            idpTimings:{type:String},
            maps:{type:String},
            details:{type:String},
            whatsappGroupLink:{type:String},
            teams:[
                {
                    teamName:{type:String},
                    teamLogo:{type:String},
                    whatsappNumber:{type:Number},
                    erangle:{type:String},
                    rando:{type:String},
                    miramar:{type:String},
                    dropDetails:{
                        erangle:{type:String},
                        rando:{type:String},
                        miramar:{type:String}
                    }
                }
            ]
        }
    ]
});

const categoryModel = mongoose.model("Categories", categorySchema);

export default categoryModel;