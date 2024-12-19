require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require("bcryptjs");

const app = express();
app.use(cors());
app.use(express.json());

const apiKey = 'e14e264ebfa010740b80b1526d711b26';
const placeholderImage = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/No-Image-Placeholder.svg/495px-No-Image-Placeholder.svg.png?20200912122019';

// Create MySQL connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}).promise();

// Test database connection
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log("Connected to MySQL database");
        connection.release();
    } catch (err) {
        console.error("Error connecting to MySQL database:", err);
    }
})();

// === ROUTES ===

// 1. Signup Route
app.post("/signup", async (req, res) => {
    const { name, email, password } = req.body;

    try {
        const hashedPassword = bcrypt.hashSync(password, 10);

        const [result] = await pool.query(
            "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
            [name, email, hashedPassword]
        );

        const userId = result.insertId;
        res.status(200).json({ message: "User registered successfully!", userId });
    } catch (err) {
        console.error("Error during signup:", err);
        res.status(500).json({ error: "Signup failed." });
    }
});

// 2. Login Route
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const [results] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);

        if (results.length === 0) {
            return res.status(400).json({ message: "User not found" });
        }

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            res.status(200).json({ message: "Login successful!", userId: user.id });
        } else {
            res.status(400).json({ message: "Invalid credentials" });
        }
    } catch (err) {
        console.error("Error during login:", err);
        res.status(500).json({ error: "Login failed." });
    }
});

// 3. Search Movie
app.post('/search-movie', async (req, res) => {
    const { movieName } = req.body;

    try {
        const response = await axios.get('https://api.themoviedb.org/3/search/movie', {
            params: {
                api_key: apiKey,
                query: movieName,
            }
        });

        const movies = response.data.results.map(movie => ({
            title: movie.title,
            releaseYear: movie.release_date ? movie.release_date.split('-')[0] : 'Unknown',
            poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : placeholderImage,
            id: movie.id,
        }));

        res.json(movies);
    } catch (err) {
        console.error("Error fetching movies:", err);
        res.status(500).json({ error: "Failed to fetch movies." });
    }
});

// 4. Rate and Review Movie
app.post('/rate-movie', async (req, res) => {
    const { title, poster, releaseyear, actors, review, rating, userid } = req.body;

    try {
        const [movieResult] = await pool.query(
            "SELECT * FROM movies WHERE title = ? AND release_date = ?",
            [title, releaseyear]
        );

        let movieId;
        if (movieResult.length === 0) {
            const [insertMovie] = await pool.query(
                "INSERT INTO movies (title, release_date, actors, poster_url) VALUES (?, ?, ?, ?)",
                [title, releaseyear, actors, poster]
            );
            movieId = insertMovie.insertId;
        } else {
            movieId = movieResult[0].id;
        }

        await pool.query("INSERT INTO reviews (user_id, movie_id, review_text) VALUES (?, ?, ?)", [userid, movieId, review]);
        await pool.query("INSERT INTO rating (user_id, movie_id, rating) VALUES (?, ?, ?)", [userid, movieId, rating]);

        res.json({ message: "Movie review and rating saved successfully!", movieId });
    } catch (err) {
        console.error("Error saving review or rating:", err);
        res.status(500).json({ message: "Failed to save review or rating." });
    }
});

// 5. Home Route - Fetch Movies with Reviews and Ratings
app.get('/home', async (req, res) => {
    try {
        const [movies] = await pool.query(`
            SELECT 
                movies.id AS movie_id,
                movies.title,
                movies.release_date,
                movies.actors,
                movies.poster_url AS poster,
                GROUP_CONCAT(reviews.review_text) AS reviews,
                AVG(rating.rating) AS average_rating
            FROM movies
            LEFT JOIN reviews ON movies.id = reviews.movie_id
            LEFT JOIN rating ON movies.id = rating.movie_id
            GROUP BY movies.id
        `);

        const formattedMovies = movies.map(movie => ({
            ...movie,
            actors: movie.actors ? movie.actors.split(',') : [],
            reviews: movie.reviews ? movie.reviews.split(',') : [],
            average_rating: movie.average_rating || 0
        }));

        res.json(formattedMovies);
    } catch (err) {
        console.error("Error fetching home data:", err);
        res.status(500).json({ message: "Failed to fetch home data." });
    }
});

// 6. Watchlist - Add Movie
app.post('/watchlist', async (req, res) => {
    const { title, poster, releaseYear, userid } = req.body;

    try {
        await pool.query(
            "INSERT INTO watchlists (title, poster, releaseYear, user_id) VALUES (?, ?, ?, ?)",
            [title, poster, releaseYear, userid]
        );

        res.status(200).json({ message: "Movie added to watchlist successfully!" });
    } catch (err) {
        console.error("Error adding to watchlist:", err);
        res.status(500).json({ message: "Failed to add to watchlist." });
    }
});

// 7. Watchlist - Show Movies
app.post('/watchlistShow', async (req, res) => {
    const { userid } = req.body;

    try {
        const [results] = await pool.query(
            "SELECT id, title, poster, releaseYear FROM watchlists WHERE user_id = ?",
            [userid]
        );

        res.json(results);
    } catch (err) {
        console.error("Error fetching watchlist:", err);
        res.status(500).json({ message: "Failed to fetch watchlist." });
    }
});

// 8. Watchlist - Delete Movie
app.post('/deleteWatchList', async (req, res) => {
    const { movieid } = req.body;

    try {
        const [result] = await pool.query("DELETE FROM watchlists WHERE id = ?", [movieid]);

        if (result.affectedRows > 0) {
            res.json({ message: "Movie removed from watchlist successfully" });
        } else {
            res.status(404).json({ message: "Movie not found in watchlist" });
        }
    } catch (err) {
        console.error("Error deleting from watchlist:", err);
        res.status(500).json({ message: "Failed to delete from watchlist." });
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
