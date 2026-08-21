import mongoose from "mongoose";

const pointTableCoverSchema = new mongoose.Schema({
    image: { type: String, required: true }
});

const pointTableCoverModel = mongoose.model("PointTableCover", pointTableCoverSchema);
export default pointTableCoverModel;
