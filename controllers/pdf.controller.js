const {

    searchPDFs,

} = require("../utils/pdfProvider");

//------------------------------------------------------
// Search PDFs
//------------------------------------------------------

exports.searchPDFs = async (req, res) => {

    try {

        const {

            query,

        } = req.query;

        if (!query) {

            return res.status(400).json({

                success: false,

                message: "Search query is required."

            });

        }

        console.log(

            "📄 PDF Search Query:",

            query

        );

        const pdfs = await searchPDFs(query);

        return res.status(200).json({

            success: true,

            total: pdfs.length,

            pdfs,

        });

    }

    catch (err) {

        console.error(

            "PDF Search Error",

            err.message

        );

        return res.status(500).json({

            success: false,

            message: "Unable to fetch PDFs.",

        });

    }

};
