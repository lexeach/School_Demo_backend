const express = require("express");

const router = express.Router();

const {

    searchPDFs,

} = require("../controllers/pdf.controller");

//------------------------------------------------------
// PDF Search
//------------------------------------------------------

router.get(

    "/search",

    searchPDFs

);

module.exports = router;
