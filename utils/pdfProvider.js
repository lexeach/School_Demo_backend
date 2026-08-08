const axios = require("axios");
const cheerio = require("cheerio");

//------------------------------------------------------
// Trusted Educational Sources
//------------------------------------------------------

const SOURCES = [

    {
        name: "NCERT",
        search: "ncert.nic.in"
    },

    {
        name: "CBSE",
        search: "cbseacademic.nic.in"
    },

    {
        name: "SelfStudys",
        search: "selfstudys.com"
    },

    {
        name: "Vedantu",
        search: "vedantu.com"
    },

    {
        name: "PW",
        search: "pw.live"
    }

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

        q: `site:${site} ${query} pdf`

    }),

    {

        timeout: 15000,

        maxRedirects: 5,

        headers: {

            "Content-Type":

                "application/x-www-form-urlencoded",

            "User-Agent":

                "Mozilla/5.0",

            "Accept-Language":

                "en-US,en;q=0.9"

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

    //--------------------------------------------------
    // Actual Link
    //--------------------------------------------------

    let href =

        $(element)

            .find(".result__title a")

            .attr("href") ||

        "";

    if (!href) {

        return;

    }

    //--------------------------------------------------
    // Decode DuckDuckGo Redirect
    //--------------------------------------------------

    try {

        if (href.startsWith("//")) {

            href = "https:" + href;

        }

        if (href.includes("uddg=")) {

            const params =

                new URL(href).searchParams;

            href =

                decodeURIComponent(

                    params.get("uddg") || ""

                );

        }

    }

    catch (e) {}

    //--------------------------------------------------
    // Valid PDF Only
    //--------------------------------------------------

    if (

        href.toLowerCase().includes(".pdf")

    ) {

        pdfs.push({

            title,

            url: href,

            source: site,

            score: score(query, {

                title,

                url: href,

            }),

        });

    }

});

        //--------------------------------------------------
// Remove duplicate domains
//--------------------------------------------------

const seenDomains = new Set();

const uniqueDomainPDFs = [];

for (const pdf of pdfs) {

    try {

        const hostname = new URL(pdf.url).hostname.replace(/^www\./, "");

        if (!seenDomains.has(hostname)) {

            seenDomains.add(hostname);

            uniqueDomainPDFs.push(pdf);

        }

    } catch {

        uniqueDomainPDFs.push(pdf);

    }

}

pdfs = uniqueDomainPDFs;
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
    removeDuplicates(results)

        .filter(pdf =>

            pdf.url.startsWith("http")

        )

        .sort(

            (a, b) =>

                b.score - a.score

        );

return unique.slice(0, 5);
}

module.exports={

    searchPDFs,

};
