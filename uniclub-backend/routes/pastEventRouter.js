const express = require('express');
const router = express.Router();
const PastEvent = require('../models/PastEvent');
const authenticateToken = require('../middleware/auth');

// GET /api/past-events - Get all past events
router.get('/', async (req, res) => {
  try {
    const pastEvents = await PastEvent.find({}).sort({ date: -1 });
    res.json({ success: true, data: pastEvents });
  } catch (error) {
    console.error('Error fetching past events:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch past events' });
  }
});

// POST /api/past-events - Create a new past event (protected)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { poster, title, subtitle, date, body, category, attendance, tags, link, gallery } = req.body;
    
    if (!poster || !title || !subtitle || !date || !body) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: poster, title, subtitle, date, and body are required' 
      });
    }
    
    const pastEvent = new PastEvent({
      poster,
      title,
      subtitle,
      date,
      body,
      category,
      attendance,
      tags,
      link,
      gallery
    });
    
    await pastEvent.save();
    res.json({ success: true, data: pastEvent });
  } catch (error) {
    console.error('Error creating past event:', error);
    res.status(500).json({ success: false, error: 'Failed to create past event' });
  }
});

// Test endpoint to verify collection exists (must come before /:id)
router.get('/test/connection', async (req, res) => {
  try {
    const count = await PastEvent.countDocuments();
    res.json({ 
      success: true, 
      message: 'PastEvent collection is accessible',
      documentCount: count,
      collectionName: 'pastevents'
    });
  } catch (error) {
    console.error('Error testing PastEvent collection:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/past-events/:id/poster - Serve poster (must come before /:id)
router.get('/:id/poster', async (req, res) => {
  try {
    const pastEvent = await PastEvent.findById(req.params.id).select('poster');
    
    if (!pastEvent || !pastEvent.poster || !pastEvent.poster.data) {
      return res.status(404).json({ error: 'Poster not found' });
    }

    // Extract base64 data (remove data:image/png;base64, prefix)
    const base64Data = pastEvent.poster.data.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');
    
    res.set('Content-Type', pastEvent.poster.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
    
  } catch (error) {
    console.error('Poster serve error:', error);
    res.status(500).json({ error: 'Failed to retrieve poster' });
  }
});

// GET /api/past-events/:id/gallery/:imageIndex - Serve gallery image by index
router.get('/:id/gallery/:imageIndex', async (req, res) => {
  try {
    const pastEvent = await PastEvent.findById(req.params.id).select('gallery');
    const imageIndex = parseInt(req.params.imageIndex);
    
    if (!pastEvent || !pastEvent.gallery || pastEvent.gallery.length === 0) {
      return res.status(404).json({ error: 'Gallery not found' });
    }
    
    if (imageIndex < 0 || imageIndex >= pastEvent.gallery.length) {
      return res.status(404).json({ error: 'Image not found in gallery' });
    }
    
    const image = pastEvent.gallery[imageIndex];
    
    if (!image || !image.data) {
      return res.status(404).json({ error: 'Image data not found' });
    }

    // Extract base64 data (remove data:image/png;base64, prefix)
    const base64Data = image.data.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');
    
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
    
  } catch (error) {
    console.error('Gallery image serve error:', error);
    res.status(500).json({ error: 'Failed to retrieve gallery image' });
  }
});

// GET /api/past-events/:id - Get a specific past event
router.get('/:id', async (req, res) => {
  try {
    const pastEvent = await PastEvent.findById(req.params.id);
    if (!pastEvent) {
      return res.status(404).json({ success: false, error: 'Past event not found' });
    }
    res.json({ success: true, data: pastEvent });
  } catch (error) {
    console.error('Error fetching past event:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch past event' });
  }
});

// PUT /api/past-events/:id - Update a past event (protected)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { poster, title, subtitle, date, body, category, attendance, tags, link, gallery } = req.body;
    
    const pastEvent = await PastEvent.findByIdAndUpdate(
      req.params.id,
      { poster, title, subtitle, date, body, category, attendance, tags, link, gallery },
      { new: true, runValidators: true }
    );
    
    if (!pastEvent) {
      return res.status(404).json({ success: false, error: 'Past event not found' });
    }
    
    res.json({ success: true, data: pastEvent });
  } catch (error) {
    console.error('Error updating past event:', error);
    res.status(500).json({ success: false, error: 'Failed to update past event' });
  }
});

// DELETE /api/past-events/:id - Delete a past event (protected)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const pastEvent = await PastEvent.findByIdAndDelete(req.params.id);
    if (!pastEvent) {
      return res.status(404).json({ success: false, error: 'Past event not found' });
    }
    res.json({ success: true, message: 'Past event deleted successfully' });
  } catch (error) {
    console.error('Error deleting past event:', error);
    res.status(500).json({ success: false, error: 'Failed to delete past event' });
  }
});

module.exports = router;

