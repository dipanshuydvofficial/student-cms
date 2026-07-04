const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'secret_key_cms',
  resave: false,
  saveUninitialized: true
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- MongoDB Connection ---
if (!process.env.MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is not set.');
  console.error('Set MONGODB_URI in Render.com dashboard under Environment Variables, then redeploy.');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    initAdmin();
  })
  .catch(err => console.error('MongoDB connection error:', err));

// --- Schemas ---
const courseSchema = new mongoose.Schema({ name: String });
const Course = mongoose.model('Course', courseSchema);

const subjectSchema = new mongoose.Schema({
  name: String,
  course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' }
});
const Subject = mongoose.model('Subject', subjectSchema);

const userSchema = new mongoose.Schema({
  full_name: String,
  email: String,
  password: { type: String, default: '123456' },
  role: { type: String, enum: ['admin', 'staff', 'student'] },
  gender: String,
  address: String,
  profile_pic: { type: String, default: 'default.png' },
  course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  session_id: String
});
const User = mongoose.model('User', userSchema);

const attendanceSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  status: String,
  date: String
});
const Attendance = mongoose.model('Attendance', attendanceSchema);

const scoreSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  score: Number
});
const Score = mongoose.model('Score', scoreSchema);

const leaveSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  role: String,
  date: String,
  message: String,
  status: { type: String, default: 'Pending' },
  created_at: { type: Date, default: Date.now }
});
const Leave = mongoose.model('Leave', leaveSchema);

const notificationSchema = new mongoose.Schema({
  message: String,
  type: String,
  created_at: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

const feedbackSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: String,
  created_at: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', feedbackSchema);

// --- Init Admin ---
async function initAdmin() {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      await User.create({
        full_name: 'Administrator',
        email: 'dipanshuydvofficial@gmail.com',
        password: 'dy2009,dy2009',
        role: 'admin'
      });
      console.log('Default admin user created: dipanshuydvofficial@gmail.com');
    }
  } catch (err) {
    console.error('Error initializing admin:', err);
  }
}

// --- Auth Middleware ---
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// --- Routes ---
app.get('/', (req, res) => res.redirect('/app'));

app.get('/login', (req, res) => {
  res.render('login', { error: req.query.error });
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
      req.session.user = user;
      return res.redirect('/app?page=dashboard');
    }
    return res.redirect('/login?error=Invalid credentials');
  } catch (err) {
    console.error(err);
    return res.redirect('/login?error=Database Error');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Shared /app handler ---
async function appHandler(req, res) {
  try {
    const success_msg = req.query.msg || '';
    const page = req.query.page || 'dashboard';
    const user = req.session.user;

    // 1. Handle GET-based deletion
    if (req.query.delete && req.query.table && req.query.id) {
      const { table, id } = req.query;
      if (table === 'courses') await Course.findByIdAndDelete(id);
      else if (table === 'subjects') await Subject.findByIdAndDelete(id);
      else if (table === 'staff' || table === 'students') await User.findByIdAndDelete(id);
      return res.redirect(`/app?page=${req.query.page}&msg=Record deleted successfully.`);
    }

    // 2. Handle POST actions
    if (req.method === 'POST') {
      const { action } = req.body;
      let msg = 'Saved successfully.';
      switch (action) {
        case 'add_course':
          await Course.create({ name: req.body.name });
          msg = 'Course added successfully.';
          break;
        case 'add_subject':
          await Subject.create({ name: req.body.name, course_id: req.body.course_id });
          msg = 'Subject added successfully.';
          break;
        case 'add_staff':
          await User.create({ ...req.body, role: 'staff' });
          msg = 'Staff added successfully.';
          break;
        case 'add_student':
          await User.create({ ...req.body, role: 'student' });
          msg = 'Student added successfully.';
          break;
        case 'save_attendance': {
          const { date, course_id, subject_id, attendance } = req.body;
          await Attendance.deleteMany({ date, subject_id, course_id });
          if (attendance && typeof attendance === 'object') {
            for (const studentId of Object.keys(attendance)) {
              await Attendance.create({
                student_id: studentId,
                subject_id,
                course_id,
                status: attendance[studentId],
                date
              });
            }
          }
          msg = 'Attendance saved successfully.';
          break;
        }
        case 'save_scores': {
          const { subject_id, score } = req.body;
          if (score && typeof score === 'object') {
            for (const studentId of Object.keys(score)) {
              if (score[studentId] !== '' && score[studentId] !== null && score[studentId] !== undefined) {
                await Score.findOneAndUpdate(
                  { student_id: studentId, subject_id },
                  { score: Number(score[studentId]) },
                  { upsert: true, new: true }
                );
              }
            }
          }
          msg = 'Scores saved successfully.';
          break;
        }
        case 'apply_leave':
          await Leave.create({
            user_id: user._id,
            role: user.role,
            date: req.body.date,
            message: req.body.message
          });
          msg = 'Leave application submitted.';
          break;
        case 'update_leave':
          await Leave.findByIdAndUpdate(req.body.leave_id, { status: req.body.status });
          msg = `Leave ${req.body.status}.`;
          break;
        case 'send_notification':
          await Notification.create({ message: req.body.message, type: req.body.type });
          msg = 'Notification sent.';
          break;
        case 'send_feedback':
          await Feedback.create({ student_id: user._id, message: req.body.message });
          msg = 'Feedback submitted.';
          break;
        default:
          msg = 'Action completed.';
      }
      return res.redirect(`/app?page=${page}&msg=${encodeURIComponent(msg)}`);
    }

    // 3. Build base data object for GET rendering
    const data = {
      user,
      page,
      success_msg,
      courses: await Course.find(),
      subjects: await Subject.find().populate('course_id'),
      fetched_students: [],
      exam_students: [],
      existing_scores: {},
      existing_attendance: {}
    };

    // 4. Page-specific data
    if (page === 'dashboard') {
      data.total_students = await User.countDocuments({ role: 'student' });
      data.total_staff = await User.countDocuments({ role: 'staff' });
      data.total_courses = await Course.countDocuments();
      data.total_subjects = await Subject.countDocuments();
      data.att_count = await Attendance.countDocuments();
      if (user.role === 'student') {
        data.total_present = await Attendance.countDocuments({ student_id: user._id, status: 'Present' });
        data.total_total = await Attendance.countDocuments({ student_id: user._id });
      }
    }

    if (page === 'manage_staff') {
      data.staffs = await User.find({ role: 'staff' });
    }

    if (page === 'manage_students') {
      data.students = await User.find({ role: 'student' }).populate('course_id');
    }

    if ((page === 'manage_attendance' || page === 'take_attendance')
        && req.query.fetch_course && req.query.fetch_date && req.query.fetch_subject) {
      const { fetch_course, fetch_date, fetch_subject } = req.query;
      data.fetched_students = await User.find({ role: 'student', course_id: fetch_course });
      const existing = await Attendance.find({ date: fetch_date, subject_id: fetch_subject });
      data.existing_attendance = {};
      existing.forEach(a => { data.existing_attendance[a.student_id.toString()] = a.status; });
      data.fetch_date = fetch_date;
      data.fetch_course = fetch_course;
      data.fetch_subject = fetch_subject;
    }

    if (page === 'manage_exams' && req.query.fetch_course && req.query.fetch_subject) {
      const { fetch_course, fetch_subject } = req.query;
      data.exam_students = await User.find({ role: 'student', course_id: fetch_course });
      const existing = await Score.find({ subject_id: fetch_subject });
      data.existing_scores = {};
      existing.forEach(s => { data.existing_scores[s.student_id.toString()] = s.score; });
      data.fetch_course = fetch_course;
      data.fetch_subject = fetch_subject;
    }

    if (page === 'notifications' && user.role === 'admin') {
      data.leaves = await Leave.find().populate('user_id').sort({ created_at: -1 });
    }

    if (page === 'staff_notifs' || page === 'student_notifs') {
      data.notifs = await Notification.find({ type: user.role }).sort({ created_at: -1 });
    }

    if (page === 'apply_leave') {
      data.my_leaves = await Leave.find({ user_id: user._id }).sort({ created_at: -1 });
    }

    if (page === 'view_attendance' && user.role === 'staff') {
      data.logs = await Attendance.find()
        .populate('student_id').populate('subject_id')
        .sort({ date: -1 }).limit(50);
    }

    if (page === 'my_attendance' && user.role === 'student') {
      data.my_att = await Attendance.find({ student_id: user._id })
        .populate('subject_id').sort({ date: -1 });
    }

    if (page === 'exam_results' && user.role === 'student') {
      data.scores = await Score.find({ student_id: user._id }).populate('subject_id');
    }

    return res.render('app', data);
  } catch (err) {
    console.error(err);
    return res.status(500).send('An error occurred while loading the page.');
  }
}

app.get('/app', requireAuth, appHandler);
app.post('/app', requireAuth, appHandler);

// --- 404 ---
app.use((req, res) => {
  res.status(404).send(`Route Not Found: ${req.method} ${req.url}`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SMS server running on port ${PORT}`);
});