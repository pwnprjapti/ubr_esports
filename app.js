import express from "express"
import dotenv from "dotenv"
import ejs from "ejs"
import path from "path"
import { fileURLToPath } from "url"
import passport from "passport"
import session from "express-session"
import './views/client/auth/google.js';

const app = express();
dotenv.config();

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

app.get("/dashboard", authCheck, (req, res)=>{
    // if(!req.isAuthenticated()) return res.redirect('/');
    console.log(req.user);
    res.render("pages/dashboard");
})

app.get("/team-settings", authCheck, (req, res)=>{
    res.render("pages/teamSettings");
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

app.get("/admin/addtournament", (req, res)=>{
    res.render("admin/pages/addtournament");
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
