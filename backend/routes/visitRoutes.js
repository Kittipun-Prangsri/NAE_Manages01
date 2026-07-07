import express from 'express';
import * as visitController from '../controllers/visitController.js';

const router = express.Router();

router.get('/today-by-tambon', visitController.getTodayByTambon);

export default router;
