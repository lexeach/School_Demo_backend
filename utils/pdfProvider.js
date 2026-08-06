const axios = require("axios");
const cheerio = require("cheerio");

//------------------------------------------------------
// Trusted Educational Sources
//------------------------------------------------------

const SOURCES = [

    {
        name: "NCERT",
        search:
            "https://ncert.nic.in/textbook.php"
    },

    {
        name: "CBSE Academic",
        search:
            "https://cbseacademic.nic.in"
    },

    {
        name: "SelfStudys",
        search:
            "https://www.selfstudys.com"
    },

    {
        name: "Vedantu",
        search:
            "https://www.vedantu.com"
    },

    {
        name: "Physics Wallah",
        search:
            "https://www.pw.live"
    },

];

//------------------------------------------------------
// Remove Duplicate PDFs
//------------------------------------------------------

function removeDuplicates(pdfs){

    const map = new Map();

    pdfs.forEach(pdf=>{

        if(!map.has(pdf.url)){

            map.set(pdf.url,pdf);

        }

    });

    return [...map.values()];

}

//------------------------------------------------------
// Relevance Score
//------------------------------------------------------

function score(query,pdf){

    let points = 0;

    const title =
        (pdf.title || "").toLowerCase();

    const q =
        query.toLowerCase();

    q.split(" ").forEach(word=>{

        if(title.includes(word)){

            points += 5;

        }

    });

    if(title.includes("ncert")){

        points += 20;

    }

    if(title.includes("cbse")){

        points += 15;

    }

    if(pdf.url.endsWith(".pdf")){

        points += 10;

    }

    return points;

}


//------------------------------------------------------
// Search One Website
//------------------------------------------------------

async function searchSite(query, site) {

    try {

        const url =

            "https://html.duckduckgo.com/html/";

        const response = await axios.post(

            url,

            new URLSearchParams({

                q: `site:${site} ${query} filetype:pdf`

            }),

            {

                headers: {

                    "Content-Type":

                        "application/x-www-form-urlencoded",

                    "User-Agent":

                        "Mozilla/5.0"

                }

            }

        );

        const $ = cheerio.load(

            response.data

        );

        const pdfs = [];

        $(".result").each((_, element) => {

            const title =

                $(element)

                    .find(".result__title")

                    .text()

                    .trim();

            const href =

                $(element)

                    .find(".result__url")

                    .text()

                    .trim();

            if (

                href &&

                href.toLowerCase()

                    .includes(".pdf")

            ) {

                pdfs.push({

                    title,

                    url: href,

                    source: site

                });

            }

        });

        return pdfs;

    }

    catch (err) {

        console.log(

            "PDF Search Error",

            site,

            err.message

        );

        return [];

    }

}



//------------------------------------------------------
// Search PDFs
//------------------------------------------------------

async function searchPDFs(query){

    const results=[];

    for(const source of SOURCES){

        try {

    const pdfs = await searchSite(

        query,

        source.search

    );

    results.push(

        ...pdfs

    );

}

catch (err) {

    console.log(

        source.name,

        err.message

    );

}
    }

    const unique =
        removeDuplicates(results);

    unique.sort((a,b)=>

        score(query,b)-score(query,a)

    );

    return unique.slice(0,5);

}

module.exports={

    searchPDFs,

};
