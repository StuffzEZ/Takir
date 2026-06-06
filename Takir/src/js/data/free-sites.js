/* ==========================================================
   data/free-sites.js
   Curated list of 100% free learning resources the AI should
   recommend. Kept small and high-signal so it fits in the
   system prompt and stays useful.
   ========================================================== */

export const FREE_SITES = [
    // --- Web / programming docs ---
    { name: 'MDN Web Docs', url: 'https://developer.mozilla.org', topics: ['html', 'css', 'javascript', 'web', 'dom', 'http'] },
    { name: 'W3Schools', url: 'https://www.w3schools.com', topics: ['html', 'css', 'javascript', 'sql', 'python', 'tutorial'] },
    { name: 'DevDocs', url: 'https://devdocs.io', topics: ['api', 'reference', 'docs'] },
    { name: 'JavaScript.info', url: 'https://javascript.info', topics: ['javascript', 'tutorial'] },
    { name: 'CSS-Tricks', url: 'https://css-tricks.com', topics: ['css', 'web'] },
    { name: 'Can I use', url: 'https://caniuse.com', topics: ['browser', 'compatibility', 'web'] },

    // --- Language docs (officially free) ---
    { name: 'Python Docs', url: 'https://docs.python.org/3/', topics: ['python', 'docs'] },
    { name: 'Rust Docs (The Book)', url: 'https://doc.rust-lang.org/book/', topics: ['rust', 'tutorial'] },
    { name: 'Rust by Example', url: 'https://doc.rust-lang.org/rust-by-example/', topics: ['rust', 'tutorial'] },
    { name: 'Go by Example', url: 'https://gobyexample.com', topics: ['go', 'tutorial'] },
    { name: 'C++ Reference', url: 'https://en.cppreference.com', topics: ['c++', 'cpp', 'c', 'reference'] },
    { name: 'Java Tutorials (Oracle)', url: 'https://docs.oracle.com/javase/tutorial/', topics: ['java', 'tutorial'] },
    { name: 'Kotlin Docs', url: 'https://kotlinlang.org/docs/', topics: ['kotlin', 'docs'] },
    { name: 'Swift Docs', url: 'https://docs.swift.org/swift-book/', topics: ['swift', 'docs'] },
    { name: 'PHP Manual', url: 'https://www.php.net/manual/en/', topics: ['php', 'docs'] },
    { name: 'Ruby Docs', url: 'https://www.ruby-lang.org/en/documentation/', topics: ['ruby', 'docs'] },

    // --- Linux / CLI / tools ---
    { name: 'The Linux Documentation Project', url: 'https://tldp.org', topics: ['linux', 'sysadmin', 'docs'] },
    { name: 'explainshell', url: 'https://explainshell.com', topics: ['bash', 'shell', 'linux'] },
    { name: 'Git - Book', url: 'https://git-scm.com/book/en/v2', topics: ['git', 'tutorial'] },
    { name: 'Pro Git', url: 'https://github.com/progit/progit2', topics: ['git', 'book'] },
    { name: 'Vim Help', url: 'https://vimhelp.org', topics: ['vim', 'editor'] },
    { name: 'Neovim Docs', url: 'https://neovim.io/doc/user/', topics: ['neovim', 'editor'] },

    // --- Free learning platforms / curricula ---
    { name: 'freeCodeCamp', url: 'https://www.freecodecamp.org', topics: ['web', 'javascript', 'python', 'curriculum'] },
    { name: 'The Odin Project', url: 'https://www.theodinproject.com', topics: ['web', 'fullstack', 'curriculum'] },
    { name: 'Khan Academy', url: 'https://www.khanacademy.org', topics: ['math', 'science', 'cs', 'economics'] },
    { name: 'MIT OpenCourseWare', url: 'https://ocw.mit.edu', topics: ['university', 'cs', 'math', 'engineering'] },
    { name: 'OpenLearn (Open University)', url: 'https://www.open.edu/openlearn/', topics: ['university', 'humanities', 'science'] },
    { name: 'CS50 (Harvard)', url: 'https://cs50.harvard.edu', topics: ['cs', 'intro', 'course'] },
    { name: 'Codecademy (free tier)', url: 'https://www.codecademy.com/catalog', topics: ['tutorial', 'interactive'] },
    { name: 'Exercism', url: 'https://exercism.org', topics: ['practice', 'exercises', 'languages'] },
    { name: 'Project Euler', url: 'https://projecteuler.net', topics: ['math', 'programming', 'puzzles'] },

    // --- Practice / challenges ---
    { name: 'LeetCode (free)', url: 'https://leetcode.com', topics: ['algorithms', 'interview', 'practice'] },
    { name: 'HackerRank', url: 'https://www.hackerrank.com', topics: ['practice', 'interview'] },
    { name: 'Codewars', url: 'https://www.codewars.com', topics: ['practice', 'kata'] },

    // --- Math / science ---
    { name: 'Wolfram MathWorld', url: 'https://mathworld.wolfram.com', topics: ['math', 'reference'] },
    { name: '3Blue1Brown (YouTube)', url: 'https://www.3blue1brown.com', topics: ['math', 'video', 'visual'] },
    { name: 'Better Explained', url: 'https://betterexplained.com', topics: ['math', 'intuition'] },
    { name: 'Khan Academy Math', url: 'https://www.khanacademy.org/math', topics: ['math'] },
    { name: 'arXiv', url: 'https://arxiv.org', topics: ['science', 'papers', 'preprint'] },
    { name: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov', topics: ['medicine', 'papers'] },

    // --- Data / ML ---
    { name: 'Kaggle Learn', url: 'https://www.kaggle.com/learn', topics: ['data', 'ml', 'python'] },
    { name: 'Hugging Face Docs', url: 'https://huggingface.co/docs', topics: ['ml', 'nlp', 'docs'] },
    { name: 'PyTorch Tutorials', url: 'https://pytorch.org/tutorials/', topics: ['pytorch', 'ml', 'tutorial'] },
    { name: 'TensorFlow Tutorials', url: 'https://www.tensorflow.org/learn', topics: ['tensorflow', 'ml', 'tutorial'] },
    { name: 'Pandas Docs', url: 'https://pandas.pydata.org/docs/', topics: ['pandas', 'python', 'data'] },

    // --- Game dev / 3D / art ---
    { name: 'Godot Docs', url: 'https://docs.godotengine.org', topics: ['godot', 'gamedev', 'docs'] },
    { name: 'Phaser Examples', url: 'https://phaser.io/examples', topics: ['phaser', 'gamedev', 'web'] },
    { name: 'Blender Manual', url: 'https://docs.blender.org/manual/en/latest/', topics: ['blender', '3d', 'docs'] },
    { name: 'Krita Manual', url: 'https://docs.krita.org/en/', topics: ['krita', 'art', 'docs'] },

    // --- Audio / music ---
    { name: 'LMMS Manual', url: 'https://lmms.io/documentation', topics: ['music', 'lmms', 'docs'] },
    { name: 'Hydrogen Manual', url: 'https://hydrogen-music.org/documentation', topics: ['music', 'drums', 'docs'] },

    // --- Hardware / electronics ---
    { name: 'Arduino Reference', url: 'https://docs.arduino.cc/', topics: ['arduino', 'electronics', 'docs'] },
    { name: 'Raspberry Pi Docs', url: 'https://www.raspberrypi.com/documentation/', topics: ['raspberry-pi', 'electronics', 'docs'] },

    // --- General reference ---
    { name: 'Wikipedia', url: 'https://en.wikipedia.org', topics: ['reference', 'general'] },
    { name: 'Wiktionary', url: 'https://en.wiktionary.org', topics: ['language', 'dictionary'] },
    { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org', topics: ['maps', 'gis'] },
    { name: 'Internet Archive', url: 'https://archive.org', topics: ['archive', 'books', 'media'] },
    { name: 'Project Gutenberg', url: 'https://www.gutenberg.org', topics: ['books', 'literature'] },

    // --- Writing / design tools ---
    { name: 'Regex101', url: 'https://regex101.com', topics: ['regex', 'tool'] },
    { name: 'Excalidraw', url: 'https://excalidraw.com', topics: ['diagramming', 'tool'] },
    { name: 'Photopea', url: 'https://www.photopea.com', topics: ['image-editing', 'tool'] },
    { name: 'draw.io', url: 'https://app.diagrams.net', topics: ['diagramming', 'tool'] },
];

/**
 * Render the free-sites list as a compact block the AI can read in its system prompt.
 * Each line: "- Name (https://url) — topics: a, b, c"
 */
export function freeSitesPromptBlock() {
    return FREE_SITES
        .map(s => `- ${s.name} (${s.url}) — topics: ${s.topics.join(', ')}`)
        .join('\n');
}

/**
 * Find sites that match a topic keyword (case-insensitive substring on topics or name).
 * Uses word-boundary matching on the reverse direction so single-letter topics
 * like "c" or "r" don't accidentally match every random word in the query.
 */
export function findFreeSitesForTopic(topic, limit = 5) {
    const t = (topic || '').toLowerCase().trim();
    if (!t) return [];
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scored = [];
    for (const s of FREE_SITES) {
        let score = 0;
        for (const x of s.topics) {
            const xl = x.toLowerCase();
            if (xl.length >= 2 && xl.includes(t)) score += 2;
            if (xl.length >= 2 && new RegExp(`\\b${escape(xl)}\\b`).test(t)) score += 2;
        }
        if (s.name.toLowerCase().includes(t)) score += 1;
        if (score > 0) scored.push({ s, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(x => x.s);
}
