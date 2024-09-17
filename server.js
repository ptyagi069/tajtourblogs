const express = require("express");
const sql = require("mssql");
const bodyParser = require("body-parser");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
require("dotenv").config();

const dbConfig = {
  user: process.env.db_user,
  password: process.env.db_password,
  server: process.env.db_server,
  database: process.env.db_name,
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

const app = express();
const port = 3000;
// const port = process.env.PORT;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/admin", express.static("admin"));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(bodyParser.json({limit: '100mb'}))
app.use(bodyParser.urlencoded({limit: "50mb", extended: true, parameterLimit:50000}));

const uploadsDir = path.join(__dirname, "uploads");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

app.use("/uploads", express.static(uploadsDir));
app.use(express.static("public"));

async function connectToDatabase() {
  try {
    await sql.connect(dbConfig);
    console.log("Connected to database");
  } catch (err) {
    console.error("Database connection failed", err);
    process.exit(1);
  }
}
//new taj mahal tours apis

app.get("/api/tajmahaltour-posts", async (req, res) => {
  try {
    const pageNumber = parseInt(req.query.page) || 1;
    const pageSize = 6;

    const result = await sql.query`
      SELECT * 
      FROM tbl_tajmahaltour_allposts where visibility = '1'
      ORDER BY createdat DESC
      OFFSET ${(pageNumber - 1) * pageSize} ROWS
      FETCH NEXT ${pageSize} ROWS ONLY
    `;

    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching posts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// endpoint for backend posts
app.get("/api/tajmahaltour-posts-admin", async (req, res) => {
  try {
    const pageNumber = parseInt(req.query.page) || 1;
    const pageSize = 6;

    const result = await sql.query`
      SELECT *
      FROM tbl_tajmahaltour_allposts
      ORDER BY createdat DESC
      OFFSET ${(pageNumber - 1) * pageSize} ROWS
      FETCH NEXT ${pageSize} ROWS ONLY
    `;

    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching posts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API to get a specific post
app.get("/api/tajmahaltour-posts/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await sql.query`
      SELECT * FROM tbl_tajmahaltour_allposts WHERE id = ${id}
    `;
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("Error fetching post:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API to create a new post
app.post("/api/tajmahaltour-posts", upload.single('image'), async (req, res) => {
  try {
    const { title, category, content, visibility, temp_content } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await sql.query`
    INSERT INTO tbl_tajmahaltour_allposts (title, category, content, image, visibility, createdat, temp_content)
    VALUES (${title}, ${category}, ${content}, ${image}, CONVERT(varbinary(max), ${visibility === '1' ? 1 : 0}), GETDATE(), ${temp_content || null});
    
    SELECT SCOPE_IDENTITY() AS id;
    `;

    const newPostId = result.recordset[0].id;

    res.status(201).json({ message: "Post created successfully", id: newPostId });
  } catch (err) {
    console.error("Error creating post:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API to update a post
app.put("/api/tajmahaltour-posts/:id", upload.single('image'), async (req, res) => {
  try {
    const id = req.params.id;
    const { title, category, content, visibility, temp_content } = req.body;
    
    let updateFields = [];
    let queryParams = {};

    if (title) {
      updateFields.push("title = @title");
      queryParams.title = title;
    }
    if (category) {
      updateFields.push("category = @category");
      queryParams.category = category;
    }
    if (content) {
      updateFields.push("content = @content");
      queryParams.content = content;
    }
    if (visibility !== undefined) {
      updateFields.push("visibility = @visibility");
      queryParams.visibility = visibility;
    }
    if (temp_content) {
      updateFields.push("temp_content = @temp_content");
      queryParams.temp_content = temp_content;
    }
    if (req.file) {
      updateFields.push("image = @image");
      queryParams.image = `/uploads/${req.file.filename}`;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const query = `
      UPDATE tbl_tajmahaltour_allposts
      SET ${updateFields.join(", ")}
      WHERE id = @id;
      SELECT @@ROWCOUNT AS rowsAffected;
    `;

    const request = new sql.Request();
    request.input('id', sql.Int, id);
    
    for (const [key, value] of Object.entries(queryParams)) {
      request.input(key, sql.NVarChar(sql.MAX), value);
    }

    const result = await request.query(query);

    const rowsAffected = result.recordset[0].rowsAffected;

    if (rowsAffected === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ message: "Post updated successfully", id });
  } catch (err) {
    console.error("Error updating post:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API to delete a post
app.delete("/api/tajmahaltour-posts/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await sql.query`
      DELETE FROM tbl_tajmahaltour_allposts
      WHERE id = ${id};

      SELECT @@ROWCOUNT AS rowsAffected;
    `;

    const rowsAffected = result.recordset[0].rowsAffected;

    if (rowsAffected === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ message: "Post deleted successfully", id });
  } catch (err) {
    console.error("Error deleting post:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API to search posts
app.get("/api/search-tajmahaltour-posts", async (req, res) => {
  try {
    const searchTerm = req.query.title;
    if (!searchTerm) {
      return res.status(400).json({ error: "Search term is required" });
    }

    const result = await sql.query`
      SELECT id, title, category, createdat, image, visibility
      FROM tbl_tajmahaltour_allposts
      WHERE title LIKE '%' + ${searchTerm} + '%'
      ORDER BY createdat DESC
    `;

    res.json(result.recordset);
  } catch (err) {
    console.error("Error searching posts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/latest-blogs-tajmahal-tours", async (req, res) => {
  try {
    const result = await sql.query`
      SELECT TOP 5 * FROM tbl_tajmahaltour_allposts where visibility = '1' ORDER BY createdat DESC
    `;
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching latest blogs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});






//culture magazine-apis hehe

app.get("/api/latest-blogs", async (req, res) => {
  try {
    const pageNumber = parseInt(req.query.page) || 1;
    const pageSize = 6;

    const result = await sql.query`
      EXEC GetLatestBlogFromMagazineForAdmin @PageNumber = ${pageNumber}, @PageSize = ${pageSize}
    `;

    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching latest blogs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/top-blogs", async (req, res) => {
  try {
    const result = await sql.query`
      SELECT TOP 7 * FROM tbl_culturemagazine_allposts ORDER BY createdat DESC
    `;
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching top blogs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/magazinepage/:blogid", async (req, res) => {
  try {
    const blogid = req.params.blogid;
    if (!blogid) {
      return res.status(400).json({ error: "Blog ID is required" });
    }

    const result = await sql.query`
      SELECT id, title, category, createdat, image, content
      FROM tbl_culturemagazine_allposts
      WHERE id = ${blogid}`;  
      
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Blog was not found" });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("Error fetching blog by ID:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

//culture magazine-admin apis here hehe

app.post("/api/magazinepage", async (req, res) => {
  try {
    const { title, category, image, content, visibility } = req.body;

    if (!title || !category || !image || !content) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const result = await sql.query`
      INSERT INTO tbl_culturemagazine_allposts (title, category, image, content, visibility, createdat)
      VALUES (${title}, ${category}, ${image}, ${content}, ${visibility}, GETDATE())

      SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;
    `;

    const newBlogId = result.recordset[0].blogid;

    res.status(201).json({ message: "Blog post created successfully", blogid: newBlogId });
  } catch (err) {
    console.error("Error creating blog post:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/magazinepage/:id", async (req, res) => {
  try {
    const id = req.params.id; 
    if (!id) {
      return res.status(400).json({ error: "ID is required" });
    }

    const { title, category, image, content, visibility } = req.body;

    if (!title || !category || !image || !content || visibility === undefined) {
      return res.status(400).json({ error: "All fields (title, category, image, content, visibility) are required" });
    }

    const result = await sql.query`
      UPDATE tbl_culturemagazine_allposts
      SET title = ${title},
          category = ${category},
          image = ${image},
          content = ${content},
          visibility = ${visibility}
      WHERE id = ${id}; -- Update to use 'id'

      SELECT @@ROWCOUNT AS rowsAffected;
    `;

    const rowsAffected = result.recordset[0].rowsAffected;

    if (rowsAffected === 0) {
      return res.status(404).json({ error: "Blog not found" });
    }

    res.json({ message: "Blog updated successfully", id }); 
  } catch (err) {
    console.error("Error updating blog:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/magazinepage/:blogid", async (req, res) => {
  try {
    const blogid = req.params.blogid;
    console.log('hello' , blogid);
    if (!blogid) {
      return res.status(400).json({ error: "Blog ID is required" });
    }

    const result = await sql.query`
      DELETE FROM tbl_culturemagazine_allposts
      WHERE id = ${blogid};

      SELECT @@ROWCOUNT AS rowsAffected;
    `;

    const rowsAffected = result.recordset[0].rowsAffected;

    if (rowsAffected === 0) {
      return res.status(404).json({ error: "Blog was not found" });
    }

    res.json({ message: "Blog deleted successfully", blogid });
  } catch (err) {
    console.error("Error deleting blog:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/search-blogs", async (req, res) => {
  try {
    const searchTerm = req.query.title;
    if (!searchTerm) {
      return res.status(400).json({ error: "Search term is required" });
    }

    const result = await sql.query`
      SELECT id, title, category, createdat, image, visibility
      FROM tbl_culturemagazine_allposts
      WHERE title LIKE '%' + ${searchTerm} + '%'
      ORDER BY createdat DESC
    `;

    res.json(result.recordset);
  } catch (err) {
    console.error("Error searching blogs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

(async () => {
  try {
    await connectToDatabase();
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to start the server:", err);
  }
})();

