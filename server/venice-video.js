import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODEL = 'wan-2.6-text-to-video';
const BASE_URL = 'https://api.venice.ai/api/v1/video';
const DURATIONS = new Set(['5s', '10s', '15s']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1']);

export function validateVideoRequest(body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const duration = body?.duration || '5s';
  const resolution = body?.resolution || '720p';
  const aspect_ratio = body?.aspect_ratio || '16:9';
  if (!prompt || prompt.length > 2000) throw new Error('Enter a video prompt of up to 2,000 characters.');
  if (!DURATIONS.has(duration) || !RESOLUTIONS.has(resolution) || !ASPECT_RATIOS.has(aspect_ratio)) {
    throw new Error('Select a supported duration, resolution, and aspect ratio.');
  }
  return { model: MODEL, prompt, duration, resolution, aspect_ratio };
}

function publicJob(row) {
  return {
    id: row.id, prompt: row.prompt, duration: row.duration,
    resolution: row.resolution, aspect_ratio: row.aspect_ratio,
    status: row.status, created_at: row.created_at
  };
}

export function registerVeniceVideoRoutes(app, pool, fetchVideo = fetch) {
  const key = () => process.env.VENICE_API_KEY;
  const noCache = (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };

  async function providerRequest(route, data) {
    const response = await fetchVideo(BASE_URL + route, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      console.error('[Venice video]', route, response.status, details.slice(0, 350));
      const error = new Error('Venice could not process this request (' + response.status + ').');
      error.status = response.status === 429 ? 429 : 502;
      throw error;
    }
    return response;
  }

  async function refundReservation(req) {
    if (!req.videoUsageReservationColumn) return;
    await pool.query(
      'UPDATE users SET ' + req.videoUsageReservationColumn + ' = GREATEST(0, ' + req.videoUsageReservationColumn + ' - 1) WHERE id = $1',
      [req.userId]
    );
  }

  app.post('/api/video/quote', noCache, async (req, res) => {
    if (!key()) return res.status(503).json({ error: 'Venice video generation is not configured yet.' });
    let options;
    try { options = validateVideoRequest(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      const response = await providerRequest('/quote', {
        model: options.model, duration: options.duration,
        resolution: options.resolution, aspect_ratio: options.aspect_ratio
      });
      const result = await response.json();
      if (typeof result.quote !== 'number' || !Number.isFinite(result.quote)) {
        throw new Error('Venice did not return a valid price quote.');
      }
      res.json({ quote: result.quote, currency: 'USD', options });
    } catch (error) {
      res.status(error.status || 502).json({ error: error.message });
    }
  });

  app.post('/api/video/queue', noCache, async (req, res) => {
    let options;
    try { options = validateVideoRequest(req.body); }
    catch (error) {
      await refundReservation(req).catch(err => console.error('[Video refund]', err));
      return res.status(400).json({ error: error.message });
    }
    try {
      await pool.query(
        "UPDATE venice_video_jobs SET status = 'expired' WHERE user_id = $1 AND status IN ('submitting', 'queued', 'processing') AND created_at < NOW() - INTERVAL '1 hour'",
        [req.userId]
      );
      const inserted = await pool.query(
        `INSERT INTO venice_video_jobs (user_id, model, prompt, duration, resolution, aspect_ratio)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.userId, options.model, options.prompt, options.duration, options.resolution, options.aspect_ratio]
      );
      const job = inserted.rows[0];
      try {
        const response = await providerRequest('/queue', options);
        const data = await response.json();
        if (!data.queue_id || data.model !== options.model) throw new Error('Venice returned an invalid queue receipt.');
        await pool.query("UPDATE venice_video_jobs SET queue_id = $1, status = 'queued' WHERE id = $2",
          [data.queue_id, job.id]);
        res.status(202).json({ ...publicJob(job), status: 'queued' });
      } catch (error) {
        await pool.query("UPDATE venice_video_jobs SET status = 'failed' WHERE id = $1", [job.id]);
        await refundReservation(req).catch(err => console.error('[Video refund]', err));
        res.status(error.status || 502).json({ error: error.message });
      }
    } catch (error) {
      await refundReservation(req).catch(err => console.error('[Video refund]', err));
      if (error.code === '23505') return res.status(409).json({ error: 'Finish or wait for your current video before starting another.' });
      console.error('[Venice video job]', error);
      res.status(503).json({ error: 'Unable to save the video request.' });
    }
  });

  app.get('/api/video/jobs', noCache, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM venice_video_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 12',
        [req.userId]
      );
      res.json(result.rows.map(publicJob));
    } catch (error) {
      res.status(503).json({ error: 'Unable to load video jobs.' });
    }
  });

  app.get('/api/video/jobs/:id/file', noCache, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM venice_video_jobs WHERE id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      );
      const job = result.rows[0];
      if (!job) return res.status(404).json({ error: 'Video job not found.' });
      if (job.status === 'failed' || job.status === 'expired') {
        return res.status(410).json({ error: 'This video job is no longer available.' });
      }
      if (!job.queue_id) return res.status(202).json({ status: 'submitting' });
      if (!key()) return res.status(503).json({ error: 'Venice video generation is not configured yet.' });
      const response = await providerRequest('/retrieve', { model: job.model, queue_id: job.queue_id });
      if (response.headers.get('content-type')?.includes('video/mp4')) {
        await pool.query("UPDATE venice_video_jobs SET status = 'completed' WHERE id = $1", [job.id]);
        res.type('video/mp4');
        res.set('Content-Disposition', 'inline; filename="llm-plus-venice-video.mp4"');
        await pipeline(Readable.fromWeb(response.body), res);
        return;
      }
      const data = await response.json();
      const status = String(data.status || '').toUpperCase();
      if (status === 'FAILED' || status === 'CANCELLED') {
        await pool.query("UPDATE venice_video_jobs SET status = 'failed' WHERE id = $1", [job.id]);
        return res.status(502).json({ error: 'Venice could not generate this video.' });
      }
      if (status === 'COMPLETED') return res.status(502).json({ error: 'Venice completed the video without a downloadable file.' });
      await pool.query("UPDATE venice_video_jobs SET status = 'processing' WHERE id = $1", [job.id]);
      res.status(202).json({ status: 'processing' });
    } catch (error) {
      if (res.headersSent) return console.error('[Venice video stream]', error);
      if (error.code === '22P02') return res.status(404).json({ error: 'Video job not found.' });
      console.error('[Venice video retrieve]', error);
      res.status(error.status || 502).json({ error: error.message || 'Unable to retrieve the video.' });
    }
  });
}