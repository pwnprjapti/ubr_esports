import mongoose from "mongoose";

const pointTableSchema = new mongoose.Schema({
    matchTitle: { type: String, required: true },
    categoryTitle: { type: String, required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Categories', required: true },
    pointTableImage: { type: String, required: true },
    date: { type: String }
});

const pointTableModel = mongoose.model("PointTable", pointTableSchema);
export default pointTableModel;
