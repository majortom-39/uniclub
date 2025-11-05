const express = require('express');
const router = express.Router();
const News = require('../models/News');
const User = require('../models/User');
const Comment = require('../models/Comment');
const authenticateToken = require('../middleware/auth');
const NewsCurationService = require('../services/NewsCurationService');
const Anthropic = require('@anthropic-ai/sdk');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const axios = require('axios');

// GET /api/news - Get all approved news (public)
router.get('/', async (req, res) => {
  try {
    const { category, page = 1, limit = 10 } = req.query;
    
    const filter = { 
      status: 'approved',
      publishedAt: { $lte: new Date() }
    };
    
    if (category && category !== 'All') {
      filter.categories = category;
    }
    
    const news = await News.find(filter)
      .populate('author', 'name uniqueId')
      .sort({ 
        isTrending: -1,     // Trending first
        isFeatured: -1,     // Then featured
        publishedAt: -1     // Then by publish date (newest first)
      })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();
    
    // Get comment counts for all articles (using modern contentId field)
    const articleIds = news.map(article => article._id);
    const commentCounts = await Comment.aggregate([
      { 
        $match: { 
          contentType: 'news',
          contentId: { $in: articleIds }, 
          status: 'active' 
        } 
      },
      { $group: { _id: '$contentId', count: { $sum: 1 } } }
    ]);
    
    const commentCountMap = {};
    commentCounts.forEach(cc => {
      commentCountMap[cc._id.toString()] = cc.count;
    });
    
    // Transform for frontend (match NewsCard props)
    const transformedNews = news.map(article => ({
      _id: article._id,
      title: article.title,
      excerpt: article.excerpt,
      content: article.content,
      source: article.source,
      originalAuthor: article.originalAuthor,
      originalUrl: article.originalUrl,
      timestamp: article.publishedAt,
      discussionCount: commentCountMap[article._id.toString()] || 0,
      imageUrl: article.imageUrl,
      isFeatured: article.isFeatured,
      isTrending: article.isTrending,
      category: article.categories[0] || 'General',
      engagement: {
        likes: article.likes || 0,
        saves: article.saves || 0,
        shares: article.shares || 0,
        comments: commentCountMap[article._id.toString()] || 0
      },
      summary: article.summary
    }));
    
    res.json(transformedNews);
  } catch (error) {
    console.error('❌ Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// GET /api/news/:id - Get single news article (public)
router.get('/:id', async (req, res) => {
  try {
    console.log('🔍 Fetching article with ID:', req.params.id);
    
    const news = await News.findById(req.params.id).lean();
    console.log('📰 Article found:', !!news);
    
    if (!news) {
      console.log('❌ Article not found in database');
      return res.status(404).json({ error: 'News article not found' });
    }
    
    console.log('📰 Article status:', news.status);
    if (news.status !== 'approved') {
      console.log('❌ Article not approved');
      return res.status(404).json({ error: 'News article not available' });
    }
    
    // No view tracking for news articles
    
    // Get comment count for this article (using modern contentId field)
    const commentCount = await Comment.countDocuments({ 
      contentType: 'news',
      contentId: req.params.id, 
      status: 'active' 
    });
    
    console.log('✅ Returning article successfully');
    console.log('📰 Publisher logo in response:', news.publisherLogo);
    console.log('📰 Source in response:', news.source);
    
    res.json({ 
      ...news, 
      summary: news.summary || { raw: news.excerpt, whyItMatters: null },
      publishedAt: news.publishedAt,
      categories: news.categories || [],
      engagement: {
        likes: news.likes || 0,
        saves: news.saves || 0,
        shares: news.shares || 0,
        comments: commentCount
      }
    });
  } catch (error) {
    console.error('❌ Error fetching news article:', error);
    res.status(500).json({ error: 'Failed to fetch news article', details: error.message });
  }
});

// POST /api/news - Create news (authenticated users only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, excerpt, content, source, categories, imageUrl } = req.body;
    
    // Validation
    if (!title || !excerpt || !content || !source) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['title', 'excerpt', 'content', 'source']
      });
    }
    
    const news = new News({
      title,
      excerpt,
      content,
      source,
      categories: categories || [],
      imageUrl,
      author: req.user.userId,
      status: 'approved', // Auto-approve for now, add moderation later
      publishedAt: new Date(),
      likes: 0,
      saves: 0,
      shares: 0,
      comments: 0
    });
    
    await news.save();
    await news.populate('author', 'name uniqueId');
    
    res.status(201).json({
      success: true,
      message: 'News article created successfully',
      news
    });
  } catch (error) {
    console.error('❌ Error creating news:', error);
    res.status(500).json({ error: 'Failed to create news article' });
  }
});

// PUT /api/news/:id/like - DEPRECATED - Use /api/engagement/like/News/:id instead
router.put('/:id/like', authenticateToken, async (req, res) => {
  console.warn('⚠️ DEPRECATED: /api/news/:id/like - Use /api/engagement/like/News/:id instead');
  res.status(410).json({
    deprecated: true,
    message: 'This endpoint is deprecated',
    use: `/api/engagement/like/News/${req.params.id}`,
    method: 'POST'
  });
});

// PUT /api/news/:id/save - DEPRECATED - Use /api/engagement/save/News/:id instead
router.put('/:id/save', authenticateToken, async (req, res) => {
  console.warn('⚠️ DEPRECATED: /api/news/:id/save - Use /api/engagement/save/News/:id instead');
  res.status(410).json({
    deprecated: true,
    message: 'This endpoint is deprecated',
    use: `/api/engagement/save/News/${req.params.id}`,
    method: 'POST'
  });
});

// POST /api/news/trigger-curation - Manually trigger news curation (admin only)
router.post('/trigger-curation', authenticateToken, async (req, res) => {
  try {
    // Temporarily allow debug user to trigger curation for testing
    if (req.user.debug) {
      console.log('🔧 Debug user triggering curation - bypassing admin check');
    } else {
      // Check if user is admin
      const user = await User.findById(req.user.userId);
      if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Only admins can trigger news curation' });
      }
    }
    
    // Option 1: Use separate process to avoid nodemon interference
    const { spawn } = require('child_process');
    const path = require('path');
    
    console.log('🚀 Spawning independent curation process...');
    const curationProcess = spawn('node', ['manual-curation.js'], {
      cwd: path.join(__dirname, '..'),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // Log process output
    curationProcess.stdout.on('data', (data) => {
      console.log(`[CURATION] ${data.toString().trim()}`);
    });
    
    curationProcess.stderr.on('data', (data) => {
      console.error(`[CURATION ERROR] ${data.toString().trim()}`);
    });
    
    curationProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Manual curation process completed successfully');
      } else {
        console.error(`❌ Manual curation process failed with exit code ${code}`);
      }
    });
    
    // Don't wait for the process - let it run independently
    curationProcess.unref();
    
    res.json({ 
      success: true,
      message: 'News curation triggered successfully in independent process',
      processId: curationProcess.pid,
      note: 'Curation is running independently and will not be affected by server restarts'
    });
  } catch (error) {
    console.error('❌ Error triggering curation:', error);
    res.status(500).json({ error: 'Failed to trigger news curation' });
  }
});

// GET /api/news/:id/summary - Get AI summary of the article
router.get('/:id/summary', async (req, res) => {
  try {
    const news = await News.findById(req.params.id).lean();
    if (!news) {
      return res.status(404).json({ error: 'News article not found' });
    }
    if (!news.originalUrl) {
      return res.status(400).json({ error: 'No original URL for this article' });
    }

    // Return existing summary if available and not too old (24 hours)
    if (news.summary?.raw && news.summary?.lastUpdated) {
      const hoursSinceUpdate = (Date.now() - new Date(news.summary.lastUpdated).getTime()) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 24) {
        return res.json({ 
          summary: news.summary.raw,
          structured: {
            keyPoints: news.summary.keyPoints || [],
            technicalDetails: news.summary.technicalDetails || '',
            industryImpact: news.summary.industryImpact || '',
            futureImplications: news.summary.futureImplications || '',
            quickTake: news.summary.quickTake || ''
          }
        });
      }
    }

    // Scrape and generate new summary
    let articleText = '';
    try {
      const response = await axios.get(news.originalUrl, { 
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      // Use Mozilla Readability with jsdom
      const dom = new JSDOM(response.data, {
        url: news.originalUrl,
        resources: "usable",
        pretendToBeVisual: false
      });
      
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      
      if (article && article.textContent) {
        articleText = article.textContent;
      } else {
        throw new Error('No content extracted from article');
          }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to scrape article', details: err?.message });
    }

    if (!articleText || articleText.length < 200) {
      return res.status(400).json({ error: 'Could not extract enough content from the original article.' });
    }

    // Generate new summary with Claude
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const prompt = `You are an AI news summarizer for a university AI club. Please analyze and summarize the following news article in a structured format that includes:

1. Key Points (3-5 bullet points)
2. Technical Details (if applicable)
3. Industry Impact
4. Future Implications
5. Quick Take (one sentence summary)

Use clear, concise language and focus on the most important aspects. Do not hallucinate or add information not present in the article.

ARTICLE:
${articleText}`;

      const msg = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const summary = msg.content?.[0]?.text || msg.content || '';
      
      if (!summary) {
        throw new Error('Failed to generate summary');
      }

      // Parse the structured summary
      const structured = parseStructuredSummary(summary);
      
      // Update the article with new summary
      await News.findByIdAndUpdate(req.params.id, {
        summary: {
          raw: summary,
          ...structured,
          lastUpdated: new Date()
        }
      });

      return res.json({ 
        summary,
        structured
      });
      
    } catch (err) {
      return res.status(500).json({ error: 'Failed to summarize article', details: err?.message });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate summary', details: error?.message });
  }
});

// Helper function to parse structured summary
function parseStructuredSummary(summary) {
  const sections = {
    keyPoints: [],
    technicalDetails: '',
    industryImpact: '',
    futureImplications: '',
    quickTake: ''
  };

  try {
    // Split into sections
    const lines = summary.split('\n');
    let currentSection = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Check for section headers
      if (trimmed.toLowerCase().includes('key points')) {
        currentSection = 'keyPoints';
        continue;
      } else if (trimmed.toLowerCase().includes('technical details')) {
        currentSection = 'technicalDetails';
        continue;
      } else if (trimmed.toLowerCase().includes('industry impact')) {
        currentSection = 'industryImpact';
        continue;
      } else if (trimmed.toLowerCase().includes('future implications')) {
        currentSection = 'futureImplications';
        continue;
      } else if (trimmed.toLowerCase().includes('quick take')) {
        currentSection = 'quickTake';
        continue;
      }
      
      // Add content to appropriate section
      if (currentSection === 'keyPoints' && (trimmed.startsWith('-') || trimmed.startsWith('•'))) {
        sections.keyPoints.push(trimmed.replace(/^[-•]\s*/, ''));
      } else if (currentSection) {
        sections[currentSection] += (sections[currentSection] ? '\n' : '') + trimmed;
      }
    }
    
    // Clean up sections
    sections.technicalDetails = sections.technicalDetails.trim();
    sections.industryImpact = sections.industryImpact.trim();
    sections.futureImplications = sections.futureImplications.trim();
    sections.quickTake = sections.quickTake.trim();
    
  } catch (error) {
    console.error('Error parsing structured summary:', error);
  }
  
  return sections;
}

module.exports = router; 