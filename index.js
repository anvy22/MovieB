const express = require('express');
require('dotenv').config();
const axios = require('axios');
const cors = require('cors');  // Importing CORS
const mysql = require('mysql2');
const bcrypt = require("bcryptjs");
const app = express();
var userId;

app.use(cors());  // Enabling CORS for all routes
app.use(express.json());

//connecting database
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,  // Your MySQL username
    password: process.env.DB_PASSWORD,  // Your MySQL password
    database: process.env.DB_NAME  // Your MySQL database
});

db.connect(err => {
    if (err) throw err;
    console.log("Connected to MySQL database");
});

const apiKey =  'e14e264ebfa010740b80b1526d711b26';
const placeholderImage = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/No-Image-Placeholder.svg/495px-No-Image-Placeholder.svg.png?20200912122019';

// Signup Route
app.post("/signup", (req, res) => {
    const { name, email, password } = req.body;
    console.log(name, email, password);

    // Hash the password
    const hashedPassword = bcrypt.hashSync(password, 10); 
    console.log(hashedPassword);

    // Insert user into the database
    const query = "INSERT INTO users (username, email, password) VALUES (?, ?, ?)";
    db.query(query, [name, email, hashedPassword], (err, result) => {
        if (err) {
            console.error("Error inserting user:", err);
            return res.status(500).json({ error: err.message });
        }

        // Check if user was inserted correctly
        const query1 = "SELECT id FROM users WHERE email = ?";
        db.query(query1, [email], (err, results) => {
            if (err) {
                console.error("Error retrieving user:", err);
                return res.status(500).json({ error: err.message });
            }

            if (results.length > 0) {
                const userid = results[0];
                return res.status(200).json({ message: "User registered successfully!", userid });
            } else {
                return res.status(500).json({ error: "User not found after insertion." });
            }
        });
    });
});


app.post("/login", (req, res) => {
    const { email, password } = req.body;
    console.log(email, password);
    const query = "SELECT * FROM users WHERE email = ?";
    db.query(query, [email], (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ error: err.message });
        }

        if (results.length > 0) {
            const user = results[0];
            bcrypt.compare(password, user.password, (err, isMatch) => {
                if (err) {
                    console.log(err);
                    return res.status(500).json({ error: err.message });
                }

                if (isMatch) {
                    console.log("Login successful");
                    const userid = results[0].id;
                    console.log("This is user ID:", userid);

                    // Return the userId to the frontend
                    return res.status(200).json({ message: "Login successful!", userid: userid });
                } else {
                    console.log("Login failed");
                    return res.status(400).json({ message: "Invalid credentials" });
                }
            });
        } else {
            console.log("User not found");
            return res.status(400).json({ message: "User not found" });
        }
    });
});



// Endpoint to search for a movie
app.post('/search-movie', async (req, res) => {
    const movieName = req.body.movieName;

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

        // Optionally fetch the cast for each movie
        for (let movie of movies) {
            const castResponse = await axios.get(`https://api.themoviedb.org/3/movie/${movie.id}/credits`, {
                params: { api_key: apiKey }
            });
            movie.actors = castResponse.data.cast.slice(0, 5).map(actor => actor.name);
        }

        res.json(movies);  // Return all movie details
    } catch (error) {
        console.error('Error fetching movie data:', error.message);
        res.status(500).json({ error: 'Failed to fetch movie data' });
    }
});

// Endpoint to submit a review
app.post('/rate-movie', async (req, res) => {
    const { movieid, title, poster, releaseyear, actors, review, rating ,userid} = req.body;
    console.log(userid);
    try {
        // Step 1: Insert the movie data into the 'movies' table (if not already present)
        let movieQuery = `SELECT * FROM movies WHERE title = ? AND release_date = ?`;
        const [movieResult] = await db.promise().query(movieQuery, [title, releaseyear]);

        let movieId;
        if (movieResult.length === 0) {
            const insertMovieQuery = `INSERT INTO movies (title, release_date,actors, poster_url) VALUES (?, ?, ?, ?)`;
            const [insertedMovie] = await db.promise().query(insertMovieQuery, [title, releaseyear,actors, poster]);
            movieId = insertedMovie.insertId;
        } else {
            movieId = movieResult[0].id; // Movie already exists
        }

        // Step 2: Insert the review data into the 'reviews' table
        const insertReviewQuery = `INSERT INTO reviews (user_id, movie_id, review_text) VALUES (?, ?, ?)`;
        await db.promise().query(insertReviewQuery, [userid, movieId, review]);

        // Step 3: Insert the rating data into the 'rating' table
        const insertRatingQuery = `INSERT INTO rating (user_id, movie_id, rating) VALUES (?, ?, ?)`;
        await db.promise().query(insertRatingQuery, [userid, movieId, rating]);

        // Send a response back to the client
        res.json({ message: 'Movie review and rating saved successfully!', movieId });
    } catch (error) {
        console.error('Error saving movie review and rating:', error);
        res.status(500).json({ message: 'Failed to save movie review and rating' });
    }
});


app.post('/watchlist', (req, res) => {
    const { movieid, title, poster, releaseYear,userid } = req.body;
  
    if (!title || !poster || !releaseYear || !userid) {
      return res.status(400).json({ message: "All fields are required" });
    }
  
    // SQL query to insert watchlist data into the database
    const query = `INSERT INTO watchlists ( title, poster, releaseYear,user_id) VALUES ( ?, ?, ?, ?)`;
  
    db.query(query, [ title, poster, releaseYear, userid], (error, results) => {
      if (error) {
        console.error("Error inserting watchlist data: ", error);
        return res.status(500).json({ message: "Failed to add to watchlist" });
      }
  
      res.status(200).json({ message: "Movie added to watchlist", watchlistId: results.insertId });
    });
  });
  

  app.get('/home', async (req, res) => {
    try {
        // Fetching movies along with reviews and ratings
       const movieQuery = `SELECT 
    movies.id AS movie_id,
    movies.title,
    movies.release_date,
    movies.actors,
    movies.poster_url AS poster,
    AVG(rating.rating) AS average_rating
FROM movies
LEFT JOIN reviews ON movies.id = reviews.movie_id
LEFT JOIN rating ON movies.id = rating.movie_id
GROUP BY movies.id
ORDER BY movie_id DESC;  -- Order by movie_id in descending order
`;

        const [movies] = await db.promise().query(movieQuery);

        // Process the movies array
        for (let movie of movies) {
            // Convert actors string to array
            movie.actors = movie.actors ? movie.actors.split(',') : [];

            // Handle reviews: Split concatenated reviews into an array and keep the order as latest first
            movie.reviews = movie.reviews ? movie.reviews.split(',') : [];
            
            // Handle rating: Set average rating to 0 if null
            movie.average_rating = movie.average_rating || 0;
        }

        console.log(movies);
        // Responding with the movies data including reviews and ratings
        res.json(movies);
    } catch (error) {
        console.error('Error fetching movies, reviews, and ratings:', error);
        res.status(500).json({ message: 'Failed to fetch movies, reviews, and ratings' });
    }
});



app.post('/showReview', async (req, res) => {
    const { movieid } = req.body;  // Get movie ID from the request body
    console.log(req.body);
    try {
        // Query to get reviews and corresponding user IDs for the given movie ID
        const [reviews] = await db.promise().query(
            'SELECT r.review_text, r.created_at, r.user_id FROM reviews r WHERE r.movie_id = ? ORDER BY r.created_at DESC',[movieid]
        );
  
        if (reviews.length === 0) {
            return res.status(200).json([]);  // No reviews found for the movie
        }
  
        // Fetch the corresponding usernames for the user IDs
        const reviewPromises = reviews.map(async (review) => {
            const [user] = await db.promise().query('SELECT username FROM users WHERE id = ?', [review.user_id]);
  
            return {
                username: user[0].username,
                comment: review.review_text,
                timestamp: review.created_at
            };
        });
  
        // Wait for all usernames to be fetched
        const fullReviews = await Promise.all(reviewPromises);
        console.log(fullReviews);
        // Send the reviews with usernames and timestamps to the frontend
        res.status(200).json(fullReviews);
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});



app.post('/watchlistShow', (req, res) => {

    const userId = req.body;
    const userid = userId.userid
    console.log("this is watchlists user id ",userId.userid);
    const query = `
    SELECT id, title, poster, releaseYear
    FROM watchlists  WHERE watchlists.user_id = ?`; // Correct syntax for parameterized query

    // Replace with actual user ID (e.g., from session or JWT token)

    db.query(query, [userid], (err, results) => {
        if (err) {
            console.error('Error fetching watchlist:', err);
            return res.status(500).json({ message: 'Error fetching watchlist' });
        }
        console.log("this id  gotten data",results);
        // Transform actors string to an array, assuming it's stored as comma-separated values in the database
        const transformedResults = results.map(movie => ({
            ...movie
            // Adjust this based on how actors are stored
        }));

        res.json(transformedResults);
    });
});

// Route to delete from watchlist
app.post('/deleteWatchList', (req, res) => {
    const { movieid } = req.body;
    console.log(movieid);
    const query = 'DELETE FROM watchlists WHERE id = ?';

    db.query(query, [movieid], (err, result) => {
        if (err) {
            console.error('Error deleting from watchlist:', err);
            return res.status(500).json({ message: 'Error deleting movie' });
        }

        if (result.affectedRows > 0) {
            res.json({ message: 'Movie removed from watchlist successfully' });
        } else {
            res.status(404).json({ message: 'Movie not found in watchlist' });
        }
    });
});


console.log(`App running on port: ${apiKey}`);


// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

