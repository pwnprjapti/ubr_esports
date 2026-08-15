import express from "express"
import dotenv from "dotenv"
import ejs from "ejs"
import path from "path"
import { fileURLToPath } from "url"
import passport from "passport"
import session from "express-session"
import mongoose from "mongoose"
import './views/client/auth/google.js';

//models

import userModel from "./models/user.model.js"
import categoryModel from "./models/category.model.js"


const app = express();
dotenv.config();

// database connection 
mongoose.connect(process.env.MONGO_URI).then(()=> console.log("database connected successfully..")).catch(err=>console.log(err));


app.use(session({
    secret:"mysecret",
    resave:false,
    saveUninitialized:true
}));

app.use(passport.initialize());
app.use(passport.session());

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.set('view engine', 'ejs');
app.set('views', [
    path.join(__dirname, 'views', 'client'),
    path.join(__dirname, 'views', 'admin'),
    path.join(__dirname, 'views')
]);
app.use(express.static(path.join(__dirname, 'assets')));
app.use(express.json());

//middleware

function authCheck(req, res, next){
    if(req.isAuthenticated()){
        return next();
    }

    res.redirect("/signin")
}

/* Client Routes */
app.get("/", (req, res)=>{
    res.render("index");
})

app.get("/terms", (req, res)=>{
    res.render("pages/terms");
})

app.get("/contactus", (req, res)=>{
    res.render("pages/contactus");
})

app.get("/privacy-policy", (req, res)=>{
    res.render("pages/privacyPolicy");
})

app.get("/aboutus", (req, res)=>{
    res.render("pages/aboutUs");
})

app.get("/signin", (req, res)=>{
    res.render("pages/signin", { googleAuthUrl: "/auth/google" });
})

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] }));
 
app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/signin', successRedirect:'/dashboard' }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/');
  });

app.get("/withdrawal", authCheck, (req, res)=>{
    res.render("pages/withdrawal");
})

app.get("/category", (req, res)=>{
    res.render("pages/category");
})

app.get("/dashboard", authCheck, async (req, res)=>{
    console.log(req.user);

    const isExist = await userModel.findOne({gglId:req.user.id});
    console.log(isExist)
    if(!isExist){
        const add = await userModel.create({gglId:req.user.id});
        const result = await add.save();
        console.log(result);
    }

    const user = {
        name:req.user.displayName,
        dp:req.user.photos[0].value,
        balance:isExist.wallet.balance
    }

    console.log(user)
    res.render("pages/dashboard", {user:user});
})

app.get("/team-settings", authCheck, (req, res)=>{
    res.render("pages/teamSettings");
})

app.post("/team-settings", authCheck, async (req, res)=>{
    console.log(req.user.id);

    const isExist = await userModel.find({gglId:req.user.id});
    if(!isExist){
        return res.status(404).json({msg:"User does not exist"});
    }

    console.log(req.body);

    const addteam = await userModel.findOneAndUpdate({gglId:req.user.id}, { team:req.body}, {returnDocument: 'after'});
    if(!addteam){
        return res.json({msg:"something went wrong in adding team please try again later"});
    }
    console.log(addteam);
    return res.status(200).json("team Created Successfully");
})

app.get("/logout", (req, res)=>{
    req.logout(()=>{
        res.redirect('/');
    })
})

/* Admin Control Panel Routes */
app.get("/admin", (req, res)=>{
    res.redirect("/admin/dashboard");
})

app.get("/admin/dashboard", (req, res)=>{
    res.render("admin/pages/dashboard");
})

app.get("/admin/categories", (req, res)=>{
    res.render("admin/pages/categories");
})

app.get("/admin/category", (req, res)=>{
    res.render("admin/pages/category");
})

app.get("/admin/addcategory", (req, res)=>{
    res.render("admin/pages/addcategory");
})

app.post("/admin/addcategory", async (req, res)=>{
    console.log(req.body);
    const isExist = await categoryModel.findOne({title:req.body.title});
    let msg;
    if(!isExist){
        const category = await categoryModel.create(req.body);
        const result = await category.save();
        if(result){
             msg = "Category created successfully"
        }
    } else {
        msg = "Category already exist with this name."
    }
    
    res.json({msg});
})

app.get("/admin/addtournament", async (req, res)=>{
    const categories = await categoryModel.find().select("title -_id");
    console.log(categories);
    res.render("admin/pages/addtournament", { categories });
})

app.post("/admin/addtournament", async (req, res)=>{
    console.log(req.body);
    const match = req.body.data;
    let msg;
    const isExist = await categoryModel.findOne({title:req.body.category, matches:{ $elemMatch : { title:req.body.data.title }}});
    console.log("is exist or not  : " + isExist);
    if(!isExist){
        const add = await categoryModel.findOneAndUpdate({title:req.body.category}, { $push:{matches:match}});
        console.log("adding touramnet" + add);
        msg = "Match added succesfully"
    }else{
        msg = " match with this title already Exists"
    }

    res.json({msg});
})

app.get("/admin/teams", (req, res)=>{
    res.render("admin/pages/teams");
})

app.get("/admin/withdrawals", (req, res)=>{
    res.render("admin/pages/withdrawals");
})

app.get("/admin/login", (req, res)=>{
    res.render("admin/pages/login");
})

app.get("/admin/signin", (req, res)=>{
    res.render("admin/pages/signin");
})

const port = process.env.PORT || 3000;

app.listen(port, ()=>{
    console.log(`Server is listening on ${port}`);
})
