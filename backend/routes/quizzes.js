const express = require('express');
const Quiz = require('../models/Quiz');
const QuizResult = require('../models/QuizResult');
const auth = require('../middleware/auth');
const router = express.Router();
const mongoose = require('mongoose');

// Create Quiz
router.post('/', auth, async (req, res) => {
    let { title, quiz_id, questions } = req.body;
    //add user_id to the quiz_id
    quiz_id = req.user.id + quiz_id;
    if (!title || !questions || questions.length === 0) {
        return res.status(400).json({ msg: 'Title and questions are required' });
    }

    try {
        let existingQuiz = await Quiz.findOne({ quiz_id });
        if (existingQuiz) {
            return res.status(400).json({ msg: 'Quiz ID already exists' });
        }

        const newQuiz = new Quiz({
            title,
            quiz_id,
            questions,
            createdBy: req.user.id
        });

        const quiz = await newQuiz.save();
        res.status(201).json(quiz);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// Get All Quizzes by User
router.get('/', auth, async (req, res) => {
    try {
        //send except object id
        const quizzes = await Quiz.find({ createdBy: req.user.id }).select('-_id -__v');
        
        
        res.json(quizzes);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// Get Single Quiz by quiz_id
router.get('/:quiz_id', auth, async (req, res) => {
    try {
        const { quiz_id } = req.params;
        console.log(quiz_id);
        const quiz = await Quiz.findOne({ quiz_id, createdBy: req.user.id });
        if (!quiz) return res.status(404).json({ msg: 'Quiz not found' });
        res.json(quiz);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// Update Quiz by quiz_id

// Update Quiz and Results for All Attendees




router.put('/:quiz_id', auth, async (req, res) => {
    const { title, questions } = req.body;
    const { quiz_id } = req.params;

    try {
        let quiz = await Quiz.findOne({ quiz_id });

        if (!quiz) {
            return res.status(404).json({ msg: 'Quiz not found' });
        }

        // Update quiz details
        quiz.title = title || quiz.title;

       // Update existing questions and add new ones
        if (questions) {
            questions.forEach(q => {
                if (q._id) {
                    // If question has _id, update existing question
                    const existingQuestion = quiz.questions.find(existingQ => existingQ._id.toString() === q._id);
                    console.log(existingQuestion);
                    if (existingQuestion) {
                        existingQuestion.question = q.question;
                        existingQuestion.options = q.options;
                        existingQuestion.correctAnswer = q.correctAnswer;
                    }
                } else {
                    // If question does not have _id, add new question
                    
                    const newQuestion = {
                        question: q.question,
                        options: q.options,
                        correctAnswer: q.correctAnswer
                    };
                    quiz.questions.push(newQuestion);
                }
            });
}

        
        quiz.lastUpdated = Date.now();

        await quiz.save();

        // Re-evaluate results for all attendees
        const attendees = quiz.takenBy;

        for (const userId of attendees) {
            const userResults = await QuizResult.findOne({ quiz_id, user_id: userId });
            console.log("Printing user results");
            console.log(userResults);
            if (userResults) {
                let newScore = 0;
                const newAnswers = userResults.answers.map(answer => {
                    const question = quiz.questions.find(q => q._id.toString() === answer.question_id.toString());
                    console.log("Printing question");
                    console.log(question);
                    if (question) {
                        const isCorrect = question.correctAnswer === answer.selectedOption;
                        if (isCorrect) {
                            newScore += 1;
                        }
                        return {
                            ...answer,
                            isCorrect
                        };
                    } else {
                        // Handle case where question is not found
                        console.log(`Question with ID ${answer.question_id} not found in quiz.`);
                        return {
                            ...answer,
                            isCorrect: false  // Assuming default behavior when question is not found
                        };
                    }
                });
        
                userResults.score = newScore;
                userResults.answers = newAnswers;
        
                await userResults.save();
            }
        }
        

        res.json({ msg: 'Quiz and results updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});


//fetch quiz to take quiz
router.get('/take/:quiz_id', auth, async (req, res) => {
    const { quiz_id } = req.params;

    try {
        const quiz = await Quiz.findOne({ quiz_id });

        if (!quiz) {
            return res.status(404).json({ msg: 'Quiz not found' });
        }

        // Prepare questions without correctAnswer
        const questionsWithoutCorrectAnswer = quiz.questions.map(question => {
            const { correctAnswer, ...questionWithoutCorrectAnswer } = question.toObject();
            return questionWithoutCorrectAnswer;
        });

        // Construct the response object
        const quizWithoutCorrectAnswers = {
            _id: quiz._id,
            title: quiz.title,
            quiz_id: quiz.quiz_id,
            questions: questionsWithoutCorrectAnswer,
            createdBy: quiz.createdBy,
            lastUpdated: quiz.lastUpdated
        };

        res.json(quizWithoutCorrectAnswers);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
}   );
// Mark Quiz as Taken
router.post('/take/:quiz_id', auth, async (req, res) => {
    const { answers } = req.body;  // Expect answers array from the frontend

    try {
        let quiz = await Quiz.findOne({ quiz_id: req.params.quiz_id });

        if (!quiz) return res.status(404).json({ msg: 'Quiz not found' });

        if (!quiz.takenBy.includes(req.user.id)) {
            quiz.takenBy.push(req.user.id);
            await quiz.save();
        }

        // Validate and process answers
        const processedAnswers = [];
        for (const answer of answers) {
            const { question_id, selectedOption } = answer;

            // Validate if questionId exists in quiz.questions
            const question = quiz.questions.find(q => q._id.toString() === question_id);
            if (!question) {
                return res.status(400).json({ msg: `Question with ID ${question_id} not found in the quiz` });
            }

            processedAnswers.push({
                question_id: question_id,
                selectedOption
            });
        }

        // Calculate score based on correct answers (if needed)
        const score = calculateScore(processedAnswers, quiz.questions);

        // Save quiz result
        const quizResult = new QuizResult({
            quiz_id: req.params.quiz_id,
            user_id: req.user.id,
            score,
            answers: processedAnswers
        });

        await quizResult.save();

        res.json({ msg: 'Quiz marked as taken and result saved' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// Function to calculate score based on correct answers (if needed)
function calculateScore(answers, questions) {
    let score = 0;
    answers.forEach(answer => {
        const question = questions.find(q => q._id.toString() === answer.question_id);
        if (question && question.correctAnswer === answer.selectedOption) {
            score++;
        }
    });
    return score;
}

// Get All Quizzes Taken by User
router.get('/taken', auth, async (req, res) => {
    try {
        const quizzes = await Quiz.find({ takenBy: req.user.id });
        res.json(quizzes);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// Get All Results by User
router.get('/results', auth, async (req, res) => {
    try {
        const results = await QuizResult.find({ user_id: req.user.id }).populate('quiz_id', 'title');
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// Get Result of Specific Test
router.get('/results/:quiz_id', auth, async (req, res) => {
    try {
        const result = await QuizResult.findOne({ quiz_id: req.params.quiz_id, user_id: req.user.id }).populate('quiz_id', 'title');
        if (!result) return res.status(404).json({ msg: 'Result not found' });
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// Get Statistics of a Specific Quiz
router.get('/stats/:quiz_id', auth, async (req, res) => {
    try {
        const quizResults = await QuizResult.find({ quiz_id: req.params.quiz_id });

        if (quizResults.length === 0) {
            return res.status(404).json({ msg: 'No results found for this quiz' });
        }

        // Calculate statistics
        const scores = quizResults.map(result => result.score);
        const min = Math.min(...scores);
        const max = Math.max(...scores);
        const sum = scores.reduce((acc, score) => acc + score, 0);
        const mean = sum / scores.length;

        scores.sort((a, b) => a - b);
        const median = scores.length % 2 === 0 
            ? (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2 
            : scores[Math.floor(scores.length / 2)];

        const mode = scores.reduce((currentMode, score, index, array) => {
            const count = array.filter(s => s === score).length;
            return count > (currentMode.count || 0) ? { value: score, count } : currentMode;
        }, {}).value || scores[0];

        res.json({ min, max, mean, median, mode });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});









module.exports = router;