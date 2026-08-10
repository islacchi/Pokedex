$(document).ready(function () {

  // ── Configuration ──────────────────────────────────────────────────────
  var CONCURRENCY   = 6;
  var BATCH_SIZE    = 30;
  var PRELOAD_MARGIN = 200;

  // Cache TTL: 7 days in ms
  var CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  var CACHE_VERSION = 2; // bump when cache schema changes
  var CACHE_KEY_POKEMON  = 'pokedex_pokemon_cache';
  var CACHE_KEY_SPECIES  = 'pokedex_species_cache';
  var CACHE_KEY_ENTRIES  = 'pokedex_entries_cache';
  var CACHE_KEY_TS       = 'pokedex_cache_ts';
  var CACHE_KEY_FAVORITES = 'pokedex_favorites';

  // ── Runtime State ──────────────────────────────────────────────────────
  var pokemonCache   = {};   // id -> full pokemon detail
  var speciesCache   = {};   // id -> species data
  var evolutionCache = {};   // chain_url -> chain data
  var pokemonEntries = [];   // raw entries from pokedex endpoint
  var allPokemonDetails = [];
  var loadedCount    = 0;
  var isLoadingBatch = false;
  var favorites      = {};   // id -> true
  var currentDetailId = null;
  var currentShiny   = false;

  // ── Filter State ───────────────────────────────────────────────────────
  var selectedTypes  = {};
  var selectedGen    = 'all';
  var favFilterActive = false;
  var sortMode       = 'id';

  // ── Generation Ranges ──────────────────────────────────────────────────
  var genRanges = {
    1: [1,151], 2:[152,251], 3:[252,386], 4:[387,493],
    5:[494,649], 6:[650,721], 7:[722,809], 8:[810,905], 9:[906,1025]
  };

  var typeColors = {
    normal:'#A8A77A', fire:'#EE8130', water:'#6390F0', electric:'#F7D02C',
    grass:'#7AC74C', ice:'#96D9D6', fighting:'#C22E28', poison:'#A33EA1',
    ground:'#E2BF65', flying:'#A98FF3', psychic:'#F95587', bug:'#A6B91A',
    rock:'#B6A136', ghost:'#735797', dragon:'#6F35FC', dark:'#705746',
    steel:'#B7B7CE', fairy:'#D685AD'
  };

  // ── Type Matchup Chart (attacking type -> defending type multiplier) ──
  // Static table — no extra API calls needed
  var typeChart = {
    normal:   { rock:0.5, ghost:0, steel:0.5 },
    fire:     { fire:0.5, water:0.5, grass:2, ice:2, bug:2, rock:0.5, dragon:0.5, steel:2 },
    water:    { fire:2, water:0.5, grass:0.5, ground:2, rock:2, dragon:0.5 },
    electric: { water:2, electric:0.5, grass:0.5, ground:0, flying:2, dragon:0.5 },
    grass:    { fire:0.5, water:2, grass:0.5, poison:0.5, ground:2, flying:0.5, bug:0.5, rock:2, dragon:0.5, steel:0.5 },
    ice:      { fire:0.5, water:0.5, grass:2, ice:0.5, ground:2, flying:2, dragon:2, steel:0.5 },
    fighting: { normal:2, ice:2, poison:0.5, flying:0.5, psychic:0.5, bug:0.5, rock:2, ghost:0, dark:2, steel:2, fairy:0.5 },
    poison:   { grass:2, poison:0.5, ground:0.5, rock:0.5, ghost:0.5, steel:0, fairy:2 },
    ground:   { fire:2, electric:2, grass:0.5, poison:2, flying:0, bug:0.5, rock:2, steel:2 },
    flying:   { electric:0.5, grass:2, fighting:2, bug:2, rock:0.5, steel:0.5 },
    psychic:  { fighting:2, poison:2, psychic:0.5, dark:0, steel:0.5 },
    bug:      { fire:0.5, grass:2, fighting:0.5, poison:0.5, flying:0.5, psychic:2, ghost:0.5, dark:2, steel:0.5, fairy:0.5 },
    rock:     { fire:2, ice:2, fighting:0.5, ground:0.5, flying:2, bug:2, steel:0.5 },
    ghost:    { normal:0, psychic:2, ghost:2, dark:0.5 },
    dragon:   { dragon:2, steel:0.5, fairy:0 },
    dark:     { fighting:0.5, psychic:2, ghost:2, dark:0.5, fairy:0.5 },
    steel:    { fire:0.5, water:0.5, electric:0.5, ice:2, rock:2, steel:0.5, fairy:2 },
    fairy:    { fire:0.5, fighting:2, poison:0.5, dragon:2, dark:2, steel:0.5 }
  };

  // Defensive type chart: defending type -> attacking type multiplier
  var defensiveChart = {
    normal:   { fighting:2, ghost:0 },
    fire:     { fire:0.5, water:2, grass:0.5, ice:0.5, ground:2, bug:0.5, rock:2, steel:0.5, fairy:0.5 },
    water:    { fire:0.5, water:0.5, electric:2, grass:2, ice:0.5, steel:0.5 },
    electric: { electric:0.5, ground:2, flying:0.5, steel:0.5 },
    grass:    { fire:2, water:0.5, electric:0.5, grass:0.5, ice:2, poison:2, ground:0.5, flying:2, bug:2, dragon:0.5, steel:0.5 },
    ice:      { fire:2, ice:0.5, fighting:2, rock:2, steel:2 },
    fighting: { flying:2, psychic:2, bug:0.5, rock:0.5, ghost:0, dark:0.5, fairy:2 },
    poison:   { grass:0.5, fighting:0.5, poison:0.5, ground:2, psychic:2, bug:0.5, fairy:0.5 },
    ground:   { water:2, electric:0, grass:2, ice:2, poison:0.5, rock:0.5 },
    flying:   { electric:2, grass:0.5, fighting:0.5, bug:0.5, rock:2, steel:0.5 },
    psychic:  { fighting:0.5, psychic:0.5, bug:2, ghost:2, dark:2 },
    bug:      { fire:2, grass:0.5, fighting:0.5, ground:0.5, flying:2, rock:2, ghost:0.5, steel:0.5 },
    rock:     { normal:0.5, fire:0.5, water:2, grass:2, fighting:2, poison:0.5, ground:2, flying:0.5, steel:2 },
    ghost:    { normal:0, fighting:0, poison:0.5, bug:0.5, ghost:2, dark:2 },
    dragon:   { fire:0.5, water:0.5, electric:0.5, grass:0.5, ice:2, fighting:0.5, ground:0.5, rock:0.5, dragon:2, fairy:2 },
    dark:     { fighting:2, psychic:0, bug:2, ghost:0.5, dark:0.5, fairy:2 },
    steel:    { normal:0.5, fire:2, water:0.5, electric:0.5, grass:0.5, ice:0.5, fighting:2, poison:0, ground:2, flying:0.5, psychic:0.5, bug:0.5, rock:0.5, dragon:0.5, steel:0.5, fairy:0.5 },
    fairy:    { fire:0.5, fighting:0.5, poison:2, dragon:0, dark:0.5, steel:2 }
  };

  // ── Favorites ─────────────────────────────────────────────────────────
  function loadFavorites() {
    try {
      var raw = localStorage.getItem(CACHE_KEY_FAVORITES);
      favorites = raw ? JSON.parse(raw) : {};
    } catch(e) { favorites = {}; }
  }

  function persistFavorites() {
    try {
      localStorage.setItem(CACHE_KEY_FAVORITES, JSON.stringify(favorites));
    } catch(e) { /* quota — ignore */ }
  }

  function isFavorite(id) { return !!favorites[id]; }

  function toggleFavorite(id) {
    if (favorites[id]) delete favorites[id];
    else favorites[id] = true;
    persistFavorites();
    // Update UI if list is visible
    if ($('#list-view').hasClass('visible')) applyFilters();
    // Update detail star if visible
    if (currentDetailId === id) {
      $('#elementos-pkm .fav-star-btn').toggleClass('active', isFavorite(id));
    }
  }

  // ── LocalStorage Cache ─────────────────────────────────────────────────
  function tryParse(str) {
    try { return JSON.parse(str); } catch(e) { return null; }
  }

  function hydrateCaches() {
    var ts = parseInt(localStorage.getItem(CACHE_KEY_TS) || '0', 10);
    var ver = parseInt(localStorage.getItem('pokedex_cache_ver') || '0', 10);
    if (!ts || (Date.now() - ts) > CACHE_TTL || ver !== CACHE_VERSION) {
      // Stale or schema mismatch — wipe
      localStorage.removeItem(CACHE_KEY_POKEMON);
      localStorage.removeItem(CACHE_KEY_SPECIES);
      localStorage.removeItem(CACHE_KEY_ENTRIES);
      localStorage.removeItem(CACHE_KEY_TS);
      localStorage.removeItem('pokedex_cache_ver');
      return false;
    }
    var p = tryParse(localStorage.getItem(CACHE_KEY_POKEMON));
    var s = tryParse(localStorage.getItem(CACHE_KEY_SPECIES));
    var e = tryParse(localStorage.getItem(CACHE_KEY_ENTRIES));
    if (p) pokemonCache  = p;
    if (s) speciesCache  = s;
    if (e) pokemonEntries = e;
    return !!(p && e);
  }

  function persistCaches() {
    try {
      localStorage.setItem(CACHE_KEY_POKEMON,  JSON.stringify(pokemonCache));
      localStorage.setItem(CACHE_KEY_SPECIES,  JSON.stringify(speciesCache));
      localStorage.setItem(CACHE_KEY_ENTRIES,  JSON.stringify(pokemonEntries));
      localStorage.setItem(CACHE_KEY_TS, String(Date.now()));
      localStorage.setItem('pokedex_cache_ver', String(CACHE_VERSION));
    } catch(e) {
      // Quota exceeded — skip silently
    }
  }

  // ── Concurrency Control ────────────────────────────────────────────────
  function asyncMapConcurrent(items, fn, concurrency) {
    var results = [];
    var index = 0;
    var active = 0;
    var done = false;
    return new Promise(function(resolve, reject) {
      function startNext() {
        while (active < concurrency && index < items.length) {
          var i = index++;
          active++;
          Promise.resolve(fn(items[i], i)).then(function(val) {
            results[i] = val;
            active--;
            if (index < items.length) startNext();
            else if (active === 0) { done = true; resolve(results); }
          }).catch(function(err) {
            active--;
            if (!done) { done = true; reject(err); }
          });
        }
      }
      startNext();
    });
  }

  // ── AJAX with Jittered Backoff Retry ──────────────────────────────────
  function ajaxWithRetry(options, retries, baseDelay) {
    retries   = (retries   === undefined) ? 1    : retries;
    baseDelay = (baseDelay === undefined) ? 2000 : baseDelay;
    return $.ajax(options).then(null, function(jqXHR) {
      if (jqXHR.status === 429 && retries > 0) {
        var jitter = Math.random() * 1000;
        var delay  = baseDelay + jitter;
        var deferred = $.Deferred();
        setTimeout(function() {
          ajaxWithRetry(options, retries - 1, baseDelay * 1.5)
            .then(deferred.resolve, deferred.reject);
        }, delay);
        return deferred.promise();
      }
      var err = $.Deferred();
      err.reject(jqXHR);
      return err.promise();
    });
  }

  // ── Sprite Helpers ─────────────────────────────────────────────────────
  function getGridSprite(sprites) {
    if (!sprites) return '';
    return sprites.front_default || '';
  }

  function getDetailSprite(sprites, shiny) {
    if (!sprites) return '';
    var official = sprites.other &&
                   sprites.other['official-artwork'] &&
                   (shiny ? sprites.other['official-artwork'].front_shiny : sprites.other['official-artwork'].front_default);
    if (official) return official;
    var home = sprites.other && sprites.other.home &&
               (shiny ? sprites.other.home.front_shiny : sprites.other.home.front_default);
    if (home) return home;
    return shiny ? (sprites.front_shiny || sprites.front_default) : (sprites.front_default || '');
  }

  function fallbackSprite(id) {
    return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + id + '.png';
  }

  // Animated sprite from Pokemon Showdown (fallback to static if unavailable)
  function getAnimatedSprite(name) {
    return 'https://play.pokemonshowdown.com/sprites/ani/' + name + '.gif';
  }

  // Get primary type color for card background tint
  function getPrimaryType(p) {
    if (!p.types || p.types.length === 0) return null;
    var typeName = p.types[0].type ? p.types[0].type.name : p.types[0];
    return typeColors[typeName] || null;
  }

  function getStat(statsArr, key) {
    var found = statsArr.find(function(s) { return s.stat.name === key; });
    return found ? found.base_stat : 0;
  }

  function getStatTotal(statsArr) {
    if (!statsArr) return 0;
    return statsArr.reduce(function(sum, s) { return sum + (s.base_stat || 0); }, 0);
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function typeBadges(types) {
    if (!types || types.length === 0) return '';
    return types.map(function(t) {
      var typeName = t.type ? t.type.name : t;
      var color = typeColors[typeName] || '#999';
      return '<span class="type-badge" style="background:' + color + '">' + capitalize(typeName) + '</span>';
    }).join(' ');
  }

  function dexNum(id) {
    return '#' + String(id).padStart(3, '0');
  }

  var PLACEHOLDER_SVG = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<circle cx="50" cy="50" r="45" fill="#ddd" stroke="#999" stroke-width="3"/>' +
    '<path d="M5 50h90" stroke="#999" stroke-width="3"/>' +
    '<circle cx="50" cy="50" r="14" fill="#fff" stroke="#999" stroke-width="3"/>' +
    '<circle cx="50" cy="50" r="6" fill="#999"/>' +
    '</svg>'
  );

  // ── Loading Indicator ──────────────────────────────────────────────────
  function showLoading() { $('#loading').removeClass('hidden'); }
  function hideLoading()  { $('#loading').addClass('hidden');   }

  // ── Loading Skeletons ────────────────────────────────────────────────
  function buildSkeletons(count) {
    var html = '';
    for (var i = 0; i < count; i++) {
      html += '<div class="skeleton-card">' +
                '<div class="skeleton-block skeleton-img"></div>' +
                '<div class="skeleton-block skeleton-text"></div>' +
                '<div class="skeleton-block skeleton-badge"></div>' +
              '</div>';
    }
    return html;
  }

  function showSkeletons(count) {
    $('#skeleton-grid').html(buildSkeletons(count || 9)).removeClass('hidden');
    $('#elementos').addClass('hidden');
  }

  function hideSkeletons() {
    $('#skeleton-grid').addClass('hidden');
    $('#elementos').removeClass('hidden');
  }

  // ── Load More Indicator ──────────────────────────────────────────────
  function showLoadMore() {
    $('#load-more-indicator').removeClass('hidden');
  }

  function hideLoadMore() {
    $('#load-more-indicator').addClass('hidden');
  }

  // ── Scroll to Top Button ─────────────────────────────────────────────
  function initScrollTopButton() {
    var $screen = $('.pokedex-screen');
    var $btn = $('#scroll-top-btn');

    $screen.on('scroll', function() {
      if ($screen.scrollTop() > 300) {
        $btn.removeClass('hidden');
      } else {
        $btn.addClass('hidden');
      }
    });

    $btn.on('click', function() {
      $screen.animate({ scrollTop: 0 }, 300);
    });
  }

  // ── Theme Toggle ────────────────────────────────────────────────────
  var CACHE_KEY_THEME = 'pokedex_theme';

  function loadTheme() {
    try {
      var theme = localStorage.getItem(CACHE_KEY_THEME);
      if (theme === 'light') {
        $('body').addClass('light-theme');
        $('#theme-toggle').text('☀️');
      }
    } catch(e) { /* ignore */ }
  }

  function initThemeToggle() {
    $('#theme-toggle').on('click', function() {
      var isLight = $('body').hasClass('light-theme');
      if (isLight) {
        $('body').removeClass('light-theme');
        $('#theme-toggle').text('🌙');
        localStorage.setItem(CACHE_KEY_THEME, 'dark');
      } else {
        $('body').addClass('light-theme');
        $('#theme-toggle').text('☀️');
        localStorage.setItem(CACHE_KEY_THEME, 'light');
      }
    });
  }

  // ── Shareable Links (URL hash) ──────────────────────────────────────
  function updateUrlHash(id) {
    if (history.replaceState) {
      history.replaceState(null, '', '#/pokemon/' + id);
    }
  }

  function clearUrlHash() {
    if (history.replaceState) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  function handleUrlHash() {
    var hash = window.location.hash;
    var match = hash.match(/^#\/pokemon\/(\d+)$/);
    if (match) {
      var id = parseInt(match[1], 10);
      if (pokemonCache[id] || allPokemonDetails.some(function(p) { return p.id === id; })) {
        navigateTo(id);
      } else {
        // Fetch the pokemon if not cached
        navigateTo(id);
      }
    }
  }

  // ── Image Lazy Loading (IntersectionObserver) ──────────────────────────
  var imageObserver = null;

  function initImageObserver() {
    if (imageObserver) return;
    if (!window.IntersectionObserver) {
      imageObserver = { observe: function() {} };
      return;
    }
    imageObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var img = entry.target;
          var src = img.getAttribute('data-src');
          if (src) { img.removeAttribute('data-src'); img.src = src; }
          imageObserver.unobserve(img);
        }
      });
    }, { rootMargin: '200px 0px', threshold: 0.01 });
  }

  function observeImage(img) {
    if (!imageObserver) initImageObserver();
    if (imageObserver && imageObserver.observe) {
      imageObserver.observe(img);
    } else {
      var src = img.getAttribute('data-src');
      if (src) { img.removeAttribute('data-src'); img.src = src; }
    }
  }

  // ── Image Error Handler ────────────────────────────────────────────────
  function makeErrorHandler(img, id, name, url, retriesLeft) {
    return function() {
      if (retriesLeft > 0) {
        setTimeout(function() {
          img.src = url;
          img.onerror = makeErrorHandler(img, id, name, url, retriesLeft - 1);
        }, 1500);
      } else {
        img.src = PLACEHOLDER_SVG;
        img.onerror = null;
      }
    };
  }

  // ── Filtering Logic ────────────────────────────────────────────────────
  function pokemonMatchesFilters(p) {
    var searchVal = $('#myInput').val().toLowerCase().trim();
    if (searchVal) {
      var nameMatch = p.name.toLowerCase().indexOf(searchVal) > -1;
      var numMatch  = p.id.toString().indexOf(searchVal) > -1;
      if (!nameMatch && !numMatch) return false;
    }

    var typeKeys = Object.keys(selectedTypes);
    if (typeKeys.length > 0) {
      var pokemonTypeNames = (p.types || []).map(function(t) {
        return t.type ? t.type.name : t;
      });
      var matchesType = typeKeys.some(function(key) {
        return pokemonTypeNames.indexOf(key) > -1;
      });
      if (!matchesType) return false;
    }

    if (selectedGen !== 'all') {
      var range = genRanges[parseInt(selectedGen)];
      if (range && (p.id < range[0] || p.id > range[1])) return false;
    }

    if (favFilterActive && !isFavorite(p.id)) return false;

    return true;
  }

  // ── Sorting ────────────────────────────────────────────────────────────
  function sortPokemon(list) {
    var sorted = list.slice();
    switch (sortMode) {
      case 'name':
        sorted.sort(function(a, b) { return a.name.localeCompare(b.name); });
        break;
      case 'stat-total':
        sorted.sort(function(a, b) { return getStatTotal(b.stats) - getStatTotal(a.stats); });
        break;
      case 'height':
        sorted.sort(function(a, b) { return (b.height || 0) - (a.height || 0); });
        break;
      case 'weight':
        sorted.sort(function(a, b) { return (b.weight || 0) - (a.weight || 0); });
        break;
      default: // 'id'
        sorted.sort(function(a, b) { return a.id - b.id; });
    }
    return sorted;
  }

  // ── Virtualized Grid ────────────────────────────────────────────────
  var VIRTUAL_PAGE_SIZE = 60;
  var virtualPage = 1;

  function applyFilters() {
    var $grid    = $('#elementos');
    var filtered = allPokemonDetails.filter(pokemonMatchesFilters);
    filtered = sortPokemon(filtered);
    var totalFiltered = filtered.length;
    var visible = filtered.slice(0, VIRTUAL_PAGE_SIZE * virtualPage);

    // Show/hide no-results message
    if (filtered.length === 0) {
      if (favFilterActive) {
        $('#no-favorites').removeClass('hidden');
        $('#no-results').addClass('hidden');
      } else {
        $('#no-results').removeClass('hidden');
        $('#no-favorites').addClass('hidden');
      }
    } else {
      $('#no-results').addClass('hidden');
      $('#no-favorites').addClass('hidden');
    }

    // Build HTML in one string — avoids N separate DOM insertions
    var html = '';
    visible.forEach(function(p) {
      var sprite      = getGridSprite(p.sprites) || fallbackSprite(p.id);
      var animated    = getAnimatedSprite(p.name);
      var displayName = capitalize(p.name);
      var favClass    = isFavorite(p.id) ? ' active' : '';
      var typeColor   = getPrimaryType(p);
      var bgStyle     = typeColor ? ' style="background:linear-gradient(135deg, ' + typeColor + '22 0%, #f5f5f0 60%)"' : '';
      html += '<div class="cont-pokemon" data-id="' + p.id + '"' + bgStyle + '>' +
                '<span class="dex-num">' + dexNum(p.id) + '</span>' +
                '<button class="fav-card-btn' + favClass + '" data-id="' + p.id + '" title="Toggle favorite">★</button>' +
                '<img class="img-pkmn" data-src="' + sprite + '" data-animated="' + animated + '" src="' + PLACEHOLDER_SVG + '" alt="' + displayName + '" loading="lazy">' +
                '<span class="pkmn-name">' + displayName + '</span>' +
                '<div class="type-badges">' + typeBadges(p.types) + '</div>' +
              '</div>';
    });
    $grid.html(html); // single DOM write

    // Attach lazy-load and error handlers
    // Try animated sprite first, fall back to static sprite, then placeholder
    $grid.find('.img-pkmn').each(function() {
      var imgEl = this;
      var $card = $(this).closest('.cont-pokemon');
      var id    = $card.data('id');
      var name  = $card.find('.pkmn-name').text();
      var staticUrl = $(this).attr('data-src');
      var animatedUrl = $(this).attr('data-animated');

      // Load animated sprite first
      imgEl.setAttribute('data-src', animatedUrl || staticUrl);
      // Fallback chain: try animated, then static, then placeholder
      imgEl.onerror = function() {
        var current = imgEl.getAttribute('data-src');
        if (current === animatedUrl && staticUrl) {
          imgEl.setAttribute('data-src', staticUrl);
          imgEl.src = staticUrl;
        } else {
          imgEl.src = PLACEHOLDER_SVG;
          imgEl.onerror = null;
        }
      };
      observeImage(imgEl);
    });

    // Show "load more" button if there are more filtered results
    if (totalFiltered > visible.length) {
      if (!$('#load-more-btn').length) {
        $grid.after('<button id="load-more-btn" class="load-more-btn">Load More</button>');
      }
      $('#load-more-btn').show();
    } else {
      $('#load-more-btn').remove();
    }

    // Attach the prefetch sentinel to the grid for infinite scroll
    setupPrefetchSentinel();
    updateScrollProgress();
  }

  // ── Prefetch / Infinite Scroll (IntersectionObserver) ──────────────────
  var prefetchObserver = null;
  var prefetchThrottleTimer = null;
  var SENTINEL_ID = 'prefetch-sentinel';

  function checkPrefetch() {
    if (isLoadingBatch) return;
    if (loadedCount >= pokemonEntries.length) return;
    if ($('#detail-view').hasClass('visible')) return;
    fetchNextBatch();
  }

  function initPrefetchObserver() {
    if (prefetchObserver) return;
    if (!window.IntersectionObserver) return; // fallback to scroll listener
    var screenEl = document.querySelector('.pokedex-screen');
    prefetchObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) checkPrefetch();
      });
    }, { root: screenEl, rootMargin: '300px 0px', threshold: 0.01 });
  }

  function setupPrefetchSentinel() {
    var $grid = $('#elementos');
    var $old = $('#' + SENTINEL_ID);
    if (prefetchObserver && prefetchObserver.unobserve && $old.length) {
      prefetchObserver.unobserve($old[0]);
    }
    $old.remove();
    var $sentinel = $('<div id="' + SENTINEL_ID + '" class="prefetch-sentinel"></div>');
    $grid.append($sentinel);
    if (prefetchObserver && prefetchObserver.observe) {
      prefetchObserver.observe($sentinel[0]);
    }
  }

  function throttledCheckPrefetch() {
    if (prefetchThrottleTimer) return;
    prefetchThrottleTimer = setTimeout(function() {
      prefetchThrottleTimer = null;
      checkPrefetch();
    }, 100);
  }

  function fetchNextBatch() {
    if (isLoadingBatch) return;
    if ($('#detail-view').hasClass('visible')) return;
    isLoadingBatch = true;

    var start = loadedCount;
    var end   = Math.min(loadedCount + BATCH_SIZE, pokemonEntries.length);
    var batch = pokemonEntries.slice(start, end);

    if (!batch.length) { isLoadingBatch = false; return; }

    showLoadMore();

    asyncMapConcurrent(batch, function(entry) {
      var id = entry.entry_number;
      if (pokemonCache[id]) return $.Deferred().resolve(pokemonCache[id]).promise();
      return ajaxWithRetry({
        url: 'https://pokeapi.co/api/v2/pokemon/' + id,
        type: 'GET', dataType: 'json'
      }, 1).then(function(data) {
        pokemonCache[id] = data;
        return data;
      });
    }, CONCURRENCY)
    .then(function() {
      batch.forEach(function(entry) {
        var id   = entry.entry_number;
        var data = pokemonCache[id];
        if (data && !allPokemonDetails.some(function(p) { return p.id === id; })) {
          allPokemonDetails.push({
            id: id, name: data.name,
            sprites: data.sprites, types: data.types, stats: data.stats,
            height: data.height, weight: data.weight
          });
        }
      });
      loadedCount = end;
      allPokemonDetails.sort(function(a, b) { return a.id - b.id; });
      isLoadingBatch = false;
      applyFilters();
      hideLoadMore();
      persistCaches(); // persist after every batch
    })
    .catch(function() {
      isLoadingBatch = false;
      hideLoadMore();
    });
  }

  // ── Species: lazy on-demand (not prefetched) ───────────────────────────
  function fetchSpeciesIfNeeded(id) {
    if (speciesCache[id]) {
      return $.Deferred().resolve(speciesCache[id]).promise();
    }
    return ajaxWithRetry({
      url: 'https://pokeapi.co/api/v2/pokemon-species/' + id,
      type: 'GET', dataType: 'json'
    }, 1).then(function(data) {
      speciesCache[id] = data;
      persistCaches();
      return data;
    });
  }

  // ── Evolution Chain ────────────────────────────────────────────────────
  function fetchAndRenderEvolution(id, $container) {
    var species = speciesCache[id];
    if (!species || !species.evolution_chain || !species.evolution_chain.url) return;

    var chainUrl = species.evolution_chain.url;

    if (evolutionCache[chainUrl] && typeof evolutionCache[chainUrl] === 'object' && !evolutionCache[chainUrl].then) {
      renderEvolutionInto($container, evolutionCache[chainUrl], id);
      return;
    }

    if (!evolutionCache[chainUrl]) {
      evolutionCache[chainUrl] = $.ajax({ url: chainUrl, type: 'GET', dataType: 'json' })
        .then(function(data) {
          evolutionCache[chainUrl] = data;
          renderEvolutionInto($container, data, id);
          return data;
        })
        .fail(function() {
          evolutionCache[chainUrl] = null;
          $container.find('.evo-loading').text('Evolution data unavailable.');
        });
    }
  }

  function renderEvolutionInto($container, chainData, currentId) {
    if (!chainData || !chainData.chain) {
      $container.remove();
      return;
    }
    var chainHtml = buildChainHtml(chainData.chain, currentId);
    $container.html(
      '<p class="evo-title">Evolution Chain</p>' +
      '<div class="evolution-chain">' + chainHtml + '</div>'
    );
    // Lazy-load evo sprites
    $container.find('.evo-sprite').each(function() {
      var imgEl = this;
      var $node = $(this).closest('.evo-node');
      var src   = $(this).attr('data-src');
      var id2   = parseInt($node.attr('data-id'), 10) || 0;
      var name2 = $node.find('.evo-name').text();
      imgEl.onerror = makeErrorHandler(imgEl, id2, name2, src, 1);
      observeImage(imgEl);
    });
  }

  function buildEvoDetailsHtml(details) {
    if (!details || details.length === 0) return 'Evolve';
    var d = details[0];
    var parts = [];
    if (d.min_level)    parts.push('Lv.' + d.min_level);
    if (d.item)         parts.push(capitalize(d.item.name.replace(/-/g, ' ')));
    else if (d.held_item) parts.push(capitalize(d.held_item.name.replace(/-/g, ' ')));
    if (d.min_happiness) parts.push('Friendship');
    if (d.trade)        parts.push('Trade');
    else if (d.known_move) parts.push('Knows ' + capitalize(d.known_move.name.replace(/-/g, ' ')));
    if (d.time_of_day)  parts.push(capitalize(d.time_of_day));
    if (d.location)     parts.push('At ' + capitalize(d.location.name.replace(/-/g, ' ')));
    if (d.min_affection) parts.push('Affection ' + d.min_affection);
    if (d.min_beauty)   parts.push('Beauty ' + d.min_beauty);
    return parts.length > 0 ? parts.join(' + ') : 'Evolve';
  }

  function buildChainHtml(chainNode, currentId) {
    var current     = chainNode.species;
    var speciesId   = extractIdFromUrl(current.url);
    var speciesName = current.name;

    var sprite = pokemonCache[speciesId]
      ? (getGridSprite(pokemonCache[speciesId].sprites) || fallbackSprite(speciesId))
      : fallbackSprite(speciesId);

    var isCurrent = (speciesId === currentId);
    var nodeHtml  = '<div class="evo-node' + (isCurrent ? ' current' : '') + '" data-id="' + speciesId + '">' +
                    '<img class="evo-sprite" data-src="' + sprite + '" src="' + PLACEHOLDER_SVG + '" alt="' + speciesName + '" loading="lazy">' +
                    '<span class="evo-name">' + capitalize(speciesName) + '</span>' +
                    '</div>';

    var evolvesTo = chainNode.evolves_to || [];
    if (!evolvesTo.length) return nodeHtml;

    if (evolvesTo.length === 1) {
      var child     = evolvesTo[0];
      var condition = buildEvoDetailsHtml(child.evolution_details);
      var arrowHtml = '<div class="evo-arrow">' +
                      '<span class="arrow-symbol">→</span>' +
                      '<span class="evo-condition">' + condition + '</span>' +
                      '</div>';
      return nodeHtml + arrowHtml + buildChainHtml(child, currentId);
    }

    var branchHtml = '<div class="branch-group">';
    evolvesTo.forEach(function(child) {
      var condition = buildEvoDetailsHtml(child.evolution_details);
      branchHtml += '<div class="branch-row">' +
                    '<div class="evo-arrow">' +
                    '<span class="arrow-symbol">→</span>' +
                    '<span class="evo-condition">' + condition + '</span>' +
                    '</div>' +
                    buildChainHtml(child, currentId) +
                    '</div>';
    });
    branchHtml += '</div>';
    return nodeHtml + branchHtml;
  }

  function extractIdFromUrl(url) {
    var parts = url.replace(/\/$/, '').split('/');
    return parseInt(parts[parts.length - 1], 10);
  }

  // ── About Section Helpers ──────────────────────────────────────────────
  function formatHeight(height) {
    // height is in decimeters; convert to meters
    if (height === undefined || height === null) return '—';
    return (height / 10).toFixed(1) + ' m';
  }

  function formatWeight(weight) {
    // weight is in hectograms; convert to kg
    if (weight === undefined || weight === null) return '—';
    return (weight / 10).toFixed(1) + ' kg';
  }

  function abilitiesHtml(abilities) {
    if (!abilities || abilities.length === 0) return '—';
    return abilities.map(function(a) {
      var name = capitalize(a.ability.name.replace(/-/g, ' '));
      if (a.is_hidden) return name + '<span class="ability-hidden">(Hidden)</span>';
      return name;
    }).join(', ');
  }

  // ── Recent History ────────────────────────────────────────────────────
  var CACHE_KEY_RECENT = 'pokedex_recent';
  var recentHistory = [];

  function loadRecent() {
    try {
      var raw = localStorage.getItem(CACHE_KEY_RECENT);
      recentHistory = raw ? JSON.parse(raw) : [];
    } catch(e) { recentHistory = []; }
  }

  function persistRecent() {
    try {
      localStorage.setItem(CACHE_KEY_RECENT, JSON.stringify(recentHistory.slice(0, 8)));
    } catch(e) { /* ignore */ }
  }

  function addToRecent(id) {
    recentHistory = recentHistory.filter(function(x) { return x !== id; });
    recentHistory.unshift(id);
    recentHistory = recentHistory.slice(0, 8);
    persistRecent();
  }

  function renderRecentSection() {
    if (!recentHistory.length) return '';
    var html = '<div class="recent-section">' +
               '<h3 class="recent-title">Recently Viewed</h3>' +
               '<div class="recent-grid">';
    recentHistory.forEach(function(id) {
      var p = pokemonCache[id];
      if (!p) return;
      var sprite = getGridSprite(p.sprites) || fallbackSprite(id);
      html += '<div class="recent-chip" data-id="' + id + '">' +
              '<img class="recent-sprite" src="' + sprite + '" alt="' + p.name + '">' +
              '<span class="recent-name">' + capitalize(p.name) + '</span>' +
              '</div>';
    });
    html += '</div></div>';
    return html;
  }

  // ── Forms & Variants ─────────────────────────────────────────────────
  function renderFormsSection(p) {
    if (!p.forms || p.forms.length <= 1) return '';
    var html = '<div class="forms-section">' +
               '<h3 class="forms-title">Forms</h3>' +
               '<div class="forms-grid">';
    p.forms.forEach(function(form) {
      var formName = form.name.replace(/-/g, ' ').replace(p.name, '').trim() || 'Default';
      var formSprite = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + p.id + '.png';
      html += '<div class="form-chip" data-form="' + form.name + '">' +
              '<img class="form-sprite" src="' + formSprite + '" alt="' + formName + '">' +
              '<span class="form-name">' + capitalize(formName) + '</span>' +
              '</div>';
    });
    html += '</div></div>';
    return html;
  }

  // ── Moves Section ────────────────────────────────────────────────────
  function renderMovesSection(p) {
    if (!p.moves || p.moves.length === 0) return '';
    var moves = p.moves.slice(0, 20);
    var html = '<div class="moves-section">' +
               '<h3 class="moves-title">Moves</h3>' +
               '<div class="moves-filter">' +
               '<button class="move-filter-chip active" data-filter="all">All</button>' +
               '<button class="move-filter-chip" data-filter="level-up">Level</button>' +
               '<button class="move-filter-chip" data-filter="machine">TM</button>' +
               '<button class="move-filter-chip" data-filter="egg">Egg</button>' +
               '</div>' +
               '<div class="moves-list">';
    moves.forEach(function(move) {
      var method = move.version_group_details && move.version_group_details[0] ?
        move.version_group_details[0].move_learn_method.name : 'unknown';
      var level = move.version_group_details && move.version_group_details[0] ?
        move.version_group_details[0].level_learned_at : 0;
      var moveName = move.move.name.replace(/-/g, ' ');
      var typeColor = '#999';
      html += '<div class="move-row" data-method="' + method + '">' +
              '<span class="move-level">' + (method === 'level-up' ? 'Lv.' + level : '—') + '</span>' +
              '<span class="move-name">' + capitalize(moveName) + '</span>' +
              '<span class="move-type" style="background:' + typeColor + '">' + method.replace(/-/g, ' ') + '</span>' +
              '</div>';
    });
    html += '</div></div>';
    return html;
  }

  // ── Locations Section ────────────────────────────────────────────────
  function renderLocationsSection(p) {
    if (!p.location_area_encounters) return '';
    var html = '<div class="locations-section">' +
               '<h3 class="locations-title">Locations</h3>' +
               '<div class="locations-list">' +
               '<div class="location-row">' +
               '<span class="location-icon">📍</span>' +
               '<span class="location-name">Loading locations…</span>' +
               '</div></div></div>';
    return html;
  }

  function fetchAndRenderLocations(id, $container) {
    if (!$container.length) return;
    $.ajax({
      url: 'https://pokeapi.co/api/v2/pokemon/' + id + '/encounters',
      type: 'GET', dataType: 'json'
    }).done(function(data) {
      if (!data || data.length === 0) {
        $container.find('.locations-list').html(
          '<div class="location-row"><span class="location-icon">📍</span>' +
          '<span class="location-name">No location data available.</span></div>'
        );
        return;
      }
      var html = '';
      data.slice(0, 5).forEach(function(loc) {
        var locName = loc.location_area.name.replace(/-/g, ' ');
        var versions = loc.version_details.map(function(v) {
          return v.version.name.replace(/-/g, ' ');
        }).join(', ');
        html += '<div class="location-row">' +
                '<span class="location-icon">📍</span>' +
                '<span class="location-name">' + capitalize(locName) + '</span>' +
                '<span class="location-version">' + versions + '</span>' +
                '</div>';
      });
      $container.find('.locations-list').html(html);
    }).fail(function() {
      $container.find('.locations-list').html(
        '<div class="location-row"><span class="location-icon">📍</span>' +
        '<span class="location-name">Location data unavailable.</span></div>'
      );
    });
  }

  // ── Stats Radar Chart ────────────────────────────────────────────────
  function buildRadarChart(stats) {
    var statKeys = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
    var labels = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
    var values = statKeys.map(function(key) { return getStat(stats, key); });
    var maxVal = 255;
    var cx = 140, cy = 140, radius = 100;
    var angleStep = (2 * Math.PI) / 6;

    function point(i, r) {
      var angle = -Math.PI / 2 + i * angleStep;
      return (cx + r * Math.cos(angle)) + ',' + (cy + r * Math.sin(angle));
    }

    // Grid rings
    var grid = '';
    for (var ring = 1; ring <= 4; ring++) {
      var r = radius * ring / 4;
      var pts = [];
      for (var i = 0; i < 6; i++) pts.push(point(i, r));
      grid += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="#2a3a4a" stroke-width="1"/>';
    }

    // Axis lines
    var axes = '';
    for (var i = 0; i < 6; i++) {
      var p = point(i, radius);
      axes += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.split(',')[0] + '" y2="' + p.split(',')[1] + '" stroke="#2a3a4a" stroke-width="1"/>';
    }

    // Data polygon
    var dataPts = [];
    for (var i = 0; i < 6; i++) {
      var r = radius * Math.min(values[i] / maxVal, 1);
      dataPts.push(point(i, r));
    }

    // Labels
    var labelHtml = '';
    for (var i = 0; i < 6; i++) {
      var lp = point(i, radius + 24);
      var lx = lp.split(',')[0], ly = lp.split(',')[1];
      labelHtml += '<text x="' + lx + '" y="' + ly + '" class="radar-axis-label" text-anchor="middle">' + labels[i] + '</text>';
    }

    // Value labels
    var valueHtml = '';
    var minLabelR = 28; // never place a value label closer to center than this
    for (var i = 0; i < 6; i++) {
      var r = radius * Math.min(values[i] / maxVal, 1);
      var labelR = Math.max(r - 12, minLabelR);
      var vp = point(i, labelR);
      var vx = vp.split(',')[0], vy = vp.split(',')[1];
      valueHtml += '<text x="' + vx + '" y="' + vy + '" class="radar-value-label" text-anchor="middle">' + values[i] + '</text>';
    }

    return '<div class="radar-chart">' +
           '<svg viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg">' +
           grid + axes +
           '<polygon points="' + dataPts.join(' ') + '" fill="rgba(204,0,0,0.3)" stroke="#cc0000" stroke-width="2"/>' +
           labelHtml + valueHtml +
           '</svg></div>';
  }

  // ── Sound Effects ────────────────────────────────────────────────────
  var soundEnabled = true;
  var CACHE_KEY_SOUND = 'pokedex_sound';

  function loadSoundPref() {
    try {
      soundEnabled = localStorage.getItem(CACHE_KEY_SOUND) !== 'off';
    } catch(e) { soundEnabled = true; }
  }

  function playClickSound() {
    if (!soundEnabled) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 600;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch(e) { /* ignore */ }
  }

  // ── Confetti ─────────────────────────────────────────────────────────
  function launchConfetti() {
    var $container = $('<div class="confetti-container"></div>');
    $('body').append($container);
    var colors = ['#cc0000', '#fbc02d', '#4caf50', '#2196F3', '#9c27b0', '#ff9800'];
    for (var i = 0; i < 50; i++) {
      var $piece = $('<div class="confetti-piece"></div>');
      $piece.css({
        left: Math.random() * 100 + '%',
        background: colors[Math.floor(Math.random() * colors.length)],
        animationDuration: (Math.random() * 2 + 1.5) + 's',
        animationDelay: (Math.random() * 0.5) + 's'
      });
      $container.append($piece);
    }
    setTimeout(function() { $container.remove(); }, 4000);
  }

  // ── Type Matchup Section ───────────────────────────────────────────────
  function buildMatchupHtml(types) {
    if (!types || types.length === 0) return '<p class="matchup-empty">No type data.</p>';

    // Get the Pokémon's defending types
    var defendingTypes = types.map(function(t) {
      return t.type ? t.type.name : t;
    });

    // Compute defensive multipliers for all attacking types
    var multipliers = {};
    Object.keys(typeColors).forEach(function(attackType) {
      var mult = 1;
      defendingTypes.forEach(function(defType) {
        var chart    = defensiveChart[defType] || {};
        var thisMult = chart[attackType];
        if (thisMult !== undefined) mult *= thisMult;
      });
      multipliers[attackType] = mult;
    });

    // Sort: 4x/2x (weaknesses) first, then 0.5x/0.25x (resistances), then 0 (immune)
    var order = { 4:0, 2:1, 0:2, 1:3, 0.5:4, 0.25:5 };
    var sortedTypes = Object.keys(multipliers).sort(function(a, b) {
      var ma = multipliers[a], mb = multipliers[b];
      var oa = order[ma] !== undefined ? order[ma] : 6;
      var ob = order[mb] !== undefined ? order[mb] : 6;
      return oa - ob;
    });

    var html = '';
    sortedTypes.forEach(function(typeName) {
      var mult = multipliers[typeName];
      if (mult === 1) return; // Skip neutral
      var color = typeColors[typeName] || '#999';
      var label = mult === 0 ? '0' : (mult === 0.25 ? '¼' : (mult === 0.5 ? '½' : '×' + mult));
      var cls = 'matchup-badge';
      if (mult === 0) cls += ' immune';
      else if (mult >= 2) cls += ' weak';
      else cls += ' resist';
      html += '<span class="' + cls + '" style="background:' + color + '">' +
                '<span class="matchup-type">' + capitalize(typeName) + '</span>' +
                '<span class="matchup-mult">' + label + '</span>' +
              '</span>';
    });

    if (!html) html = '<p class="matchup-neutral">No strong matchups — all neutral.</p>';
    return html;
  }

  // ── Detail View ────────────────────────────────────────────────────────
  function renderDetail(id) {
    var p = pokemonCache[id];
    if (!p) return;

    currentDetailId = id;
    currentShiny = false;

    var sprite      = getDetailSprite(p.sprites, false) || fallbackSprite(p.id);
    var displayName = capitalize(p.name);
    var species     = speciesCache[id];
    var flavorText  = '';

    if (species && species.flavor_text_entries) {
      var entry = species.flavor_text_entries.find(function(e) {
        return e.language.name === 'en';
      });
      if (entry) flavorText = entry.flavor_text.replace(/[\n\f]/g, ' ');
    }

    var statDefs = [
      { key: 'hp',             label: 'HP'     },
      { key: 'attack',         label: 'Attack' },
      { key: 'defense',        label: 'Defense'},
      { key: 'special-attack', label: 'Sp. Atk'},
      { key: 'special-defense',label: 'Sp. Def'},
      { key: 'speed',          label: 'Speed'  }
    ];

    var statBars = statDefs.map(function(s) {
      var val = getStat(p.stats, s.key);
      var pct = Math.min((val / 255) * 100, 100);
      return '<div class="stat-row">' +
               '<span class="stat-label">' + s.label + '</span>' +
               '<div class="stat-bar-bg"><div class="stat-bar-fill" style="width:' + pct + '%"></div></div>' +
               '<span class="stat-value">' + val + '</span>' +
             '</div>';
    }).join('');

    var favClass = isFavorite(id) ? ' active' : '';

    // Add to recent history
    addToRecent(id);

    var html =
      '<div class="info-pokemon">' +
        '<div class="detail-header">' +
          '<span class="detail-dex-num">' + dexNum(p.id) + '</span>' +
          '<h2 class="detail-name">' + displayName + '</h2>' +
          '<div class="detail-types">' + typeBadges(p.types) + '</div>' +
        '</div>' +
        '<div class="detail-sprite-wrap">' +
          '<img class="specific-info" src="' + PLACEHOLDER_SVG + '" data-src="' + sprite + '" alt="' + displayName + '">' +
          '<button class="fav-star-btn' + favClass + '" data-id="' + id + '" title="Toggle favorite">★</button>' +
          '<button class="shiny-toggle" title="Toggle shiny form">✨ Shiny</button>' +
          '<button class="cry-btn" title="Play cry">🔊</button>' +
        '</div>' +
        (flavorText ? '<p class="flavor-text">' + flavorText + '</p>' : '') +
        '<div class="matchup-section">' +
          '<h3 class="matchup-title">Type Matchups</h3>' +
          '<div class="matchup-grid">' + buildMatchupHtml(p.types) + '</div>' +
        '</div>' +
        '<div class="about-section">' +
          '<h3 class="about-title">About</h3>' +
          '<div class="about-grid">' +
            '<div class="about-item">' +
              '<span class="about-item-label">Height</span>' +
              '<span class="about-item-value">' + formatHeight(p.height) + '</span>' +
            '</div>' +
            '<div class="about-item">' +
              '<span class="about-item-label">Weight</span>' +
              '<span class="about-item-value">' + formatWeight(p.weight) + '</span>' +
            '</div>' +
            '<div class="about-item">' +
              '<span class="about-item-label">Abilities</span>' +
              '<span class="about-item-value">' + abilitiesHtml(p.abilities) + '</span>' +
            '</div>' +
            '<div class="about-item">' +
              '<span class="about-item-label">Base Exp</span>' +
              '<span class="about-item-value">' + (p.base_experience || '—') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        renderFormsSection(p) +
        renderMovesSection(p) +
        renderLocationsSection(p) +
        '<div class="evolution-section" id="evo-section">' +
          '<p class="evo-loading" style="color:#888;text-align:center;font-size:10px;font-family:\'Press Start 2P\',monospace;">Loading evolution…</p>' +
        '</div>' +
        '<div class="stats-section">' +
          '<h3 class="stats-title">Base Stats</h3>' +
          buildRadarChart(p.stats) +
          '<div class="stats-bars">' + statBars + '</div>' +
        '</div>' +
        renderRecentSection() +
      '</div>';

    $('#elementos-pkm').html(html);

    // Lazy-load the detail hero image
    var $heroImg = $('#elementos-pkm .specific-info');
    if ($heroImg.length) {
      var heroEl = $heroImg[0];
      heroEl.onerror = makeErrorHandler(heroEl, id, displayName, sprite, 1);
      observeImage(heroEl);
    }

    // Update prev/next buttons
    updateNavButtons(id);

    // Async render evolution chain into its placeholder
    fetchAndRenderEvolution(id, $('#evo-section'));

    // Async render locations
    fetchAndRenderLocations(id, $('#elementos-pkm .locations-section'));
  }

  // ── Shiny Toggle ───────────────────────────────────────────────────────
  function toggleShiny() {
    if (!currentDetailId) return;
    var p = pokemonCache[currentDetailId];
    if (!p) return;

    currentShiny = !currentShiny;
    var sprite = getDetailSprite(p.sprites, currentShiny) || fallbackSprite(p.id);

    var $img = $('#elementos-pkm .specific-info');
    if ($img.length) {
      var imgEl = $img[0];
      imgEl.src = PLACEHOLDER_SVG;
      imgEl.setAttribute('data-src', sprite);
      imgEl.onerror = makeErrorHandler(imgEl, currentDetailId, capitalize(p.name), sprite, 1);
      observeImage(imgEl);
    }

    $('.shiny-toggle').toggleClass('active', currentShiny);
  }

  // ── Prev / Next Navigation ─────────────────────────────────────────────
  function updateNavButtons(id) {
    var ids = allPokemonDetails.map(function(p) { return p.id; }).sort(function(a, b) { return a - b; });
    var idx = ids.indexOf(id);
    $('#prev-btn').prop('disabled', idx <= 0);
    $('#next-btn').prop('disabled', idx < 0 || idx >= ids.length - 1);
  }

  function navigateTo(id) {
    if (!id) return;
    showLoading();
    var fetchPokemon = pokemonCache[id]
      ? $.Deferred().resolve(pokemonCache[id]).promise()
      : ajaxWithRetry({ url: 'https://pokeapi.co/api/v2/pokemon/' + id, type: 'GET', dataType: 'json' }, 1)
          .then(function(data) { pokemonCache[id] = data; return data; });

    fetchPokemon.then(function() {
      return fetchSpeciesIfNeeded(id);
    }).then(function() {
      renderDetail(id);
      hideLoading();
      showDetailView();
      updateUrlHash(id);
      $('.pokedex-screen').scrollTop(0);
    }).fail(function() {
      hideLoading();
      swal('Error!', 'Could not load Pokémon details.', 'error');
    });
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  function showDetailView() {
    $('#list-view').removeClass('visible').addClass('hidden');
    $('#detail-view').removeClass('hidden').addClass('visible');
    $('.pokedex-screen').addClass('detail-open');
  }

  function showListView() {
    $('#detail-view').removeClass('visible').addClass('hidden');
    $('#list-view').removeClass('hidden').addClass('visible');
    $('.pokedex-screen').removeClass('detail-open');
    clearUrlHash();
    setTimeout(checkPrefetch, 100);
  }

  // ── Scroll Progress Bar (bottom action bar) ────────────────────────────
  function updateScrollProgress() {
    var $bar = $('#detail-progress-fill');
    var $screen = $('.pokedex-screen');
    var st = $screen.scrollTop();
    var total = $screen[0].scrollHeight - $screen[0].clientHeight;
    var pct = total > 0 ? (st / total) * 100 : 0;
    $bar.css('width', pct + '%');
  }

  // ── Swipe Navigation on Detail View ───────────────────────────────────
  var swipeStartX = null;
  var swipeStartY = null;

  function initSwipeNavigation() {
    var $screen = $('.pokedex-screen');

    $screen.on('touchstart', '.detail-card', function(e) {
      var touch = e.originalEvent.touches[0];
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
    });

    $screen.on('touchend', '.detail-card', function(e) {
      if (swipeStartX === null) return;
      var touch = e.originalEvent.changedTouches[0];
      var dx = touch.clientX - swipeStartX;
      var dy = touch.clientY - swipeStartY;
      var absX = Math.abs(dx);
      var absY = Math.abs(dy);

      // Reset swipe start
      swipeStartX = null;
      swipeStartY = null;

      // Only trigger if horizontal swipe is dominant and passes threshold
      if (absX > 60 && absX > absY * 1.5) {
        if (dx < 0) {
          // Swipe left → next
          $('#next-btn').trigger('click');
        } else {
          // Swipe right → previous
          $('#prev-btn').trigger('click');
        }
      }
    });
  }

  // ── Initial Fetch ──────────────────────────────────────────────────────
  function bootstrapFromCache() {
    // Build allPokemonDetails from hydrated pokemonCache
    Object.keys(pokemonCache).forEach(function(idStr) {
      var id   = parseInt(idStr, 10);
      var data = pokemonCache[id];
      if (data) {
        allPokemonDetails.push({
          id: id, name: data.name,
          sprites: data.sprites, types: data.types, stats: data.stats,
          height: data.height, weight: data.weight
        });
      }
    });
    allPokemonDetails.sort(function(a, b) { return a.id - b.id; });
    loadedCount = allPokemonDetails.length;
  }

  function fetchAllPokemonDetails(entries) {
    loadedCount = 0;
    var initialBatch = entries.slice(0, BATCH_SIZE);
    showSkeletons(9);

    asyncMapConcurrent(initialBatch, function(entry) {
      var id = entry.entry_number;
      if (pokemonCache[id]) return $.Deferred().resolve(pokemonCache[id]).promise();
      return ajaxWithRetry({
        url: 'https://pokeapi.co/api/v2/pokemon/' + id,
        type: 'GET', dataType: 'json'
      }, 1).then(function(data) {
        pokemonCache[id] = data;
        return data;
      });
    }, CONCURRENCY)
    .then(function() {
      initialBatch.forEach(function(entry) {
        var id   = entry.entry_number;
        var data = pokemonCache[id];
        if (data && !allPokemonDetails.some(function(p) { return p.id === id; })) {
          allPokemonDetails.push({
            id: id, name: data.name,
            sprites: data.sprites, types: data.types, stats: data.stats,
            height: data.height, weight: data.weight
          });
        }
      });
      loadedCount = initialBatch.length;
      allPokemonDetails.sort(function(a, b) { return a.id - b.id; });
      applyFilters();
      hideSkeletons();
      persistCaches();
    })
    .catch(function() {
      hideSkeletons();
      swal('Error!', 'Failed to load Pokémon data. Please try again.', 'error');
    });
  }

  function fetchPokedex() {
    showLoading();
    $.ajax({ url: 'https://pokeapi.co/api/v2/pokedex/1', type: 'GET', dataType: 'json' })
    .done(function(response) {
      pokemonEntries = response.pokemon_entries;
      fetchAllPokemonDetails(pokemonEntries);
    })
    .fail(function() {
      hideLoading();
      swal('Error!', 'Could not connect to the Pokédex. Check your connection and try again.', 'error');
    });
  }

  // ── Debounce Helper ────────────────────────────────────────────────────
  function debounce(fn, delay) {
    var timer = null;
    return function() {
      var args = arguments;
      var ctx = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function() {
        fn.apply(ctx, args);
      }, delay);
    };
  }

  // ── Init ───────────────────────────────────────────────────────────────
  initImageObserver();
  initPrefetchObserver();
  initSwipeNavigation();
  initTypeChips();
  loadFavorites();
  loadRecent();
  loadSoundPref();
  initScrollTopButton();
  loadTheme();
  initThemeToggle();
  handleUrlHash();

  // Hydrate from localStorage; skip network on return visits
  var wasCached = hydrateCaches();
  if (wasCached && pokemonEntries.length > 0) {
    bootstrapFromCache();
    applyFilters();
  } else {
    fetchPokedex();
  }

  // ── Scroll Listener (fallback + progress) ─────────────────────────────
  $('.pokedex-screen').on('scroll', function() {
    // Fallback for browsers without IntersectionObserver
    if (!window.IntersectionObserver) throttledCheckPrefetch();
    // Update scroll progress bar
    updateScrollProgress();
  });

  // ── Search (debounced) ─────────────────────────────────────────────────
  $('#myInput').on('keyup', debounce(function() { applyFilters(); }, 200));

  // ── Type Filter Chips ──────────────────────────────────────────────────
  function initTypeChips() {
    var $container = $('#type-chips');
    $container.empty();
    Object.keys(typeColors).forEach(function(typeName) {
      var color = typeColors[typeName];
      var $chip = $('<button class="type-chip" data-type="' + typeName + '" style="background:' + color + '">' + capitalize(typeName) + '</button>');
      $chip.on('click', function() {
        $(this).toggleClass('active');
        if ($(this).hasClass('active')) selectedTypes[typeName] = true;
        else delete selectedTypes[typeName];
        applyFilters();
      });
      $container.append($chip);
    });
  }

  // ── Filter Panel Toggle ─────────────────────────────────────────────
  $('#filter-toggle').on('click', function() {
    var $panel = $('#filter-panel');
    var isHidden = $panel.hasClass('hidden');
    $panel.toggleClass('hidden', !isHidden);
    $(this).toggleClass('active', isHidden);
  });

  $('#clear-types').on('click', function() {
    $('.type-chip').removeClass('active');
    selectedTypes = {};
    applyFilters();
  });

  $(document).on('click', '.gen-chip', function() {
    if ($(this).hasClass('active')) return;
    $('.gen-chip').removeClass('active');
    $(this).addClass('active');
    selectedGen = $(this).data('gen');
    applyFilters();
  });

  // ── Favorites Filter ───────────────────────────────────────────────────
  $('#fav-filter').on('click', function() {
    favFilterActive = !favFilterActive;
    $(this).toggleClass('active', favFilterActive);
    applyFilters();
  });

  // ── Sort ───────────────────────────────────────────────────────────────
  $('#sort-select').on('change', function() {
    sortMode = $(this).val();
    applyFilters();
  });

  // ── Click: Load More (virtualized grid) ───────────────────────────────
  $(document).on('click', '#load-more-btn', function() {
    virtualPage++;
    applyFilters();
  });

  // ── Click: Card → Detail ───────────────────────────────────────────────
  $(document).on('click', '.cont-pokemon', function(e) {
    // Don't trigger when clicking the favorite star
    if ($(e.target).hasClass('fav-card-btn')) return;
    // Don't navigate when in compare mode
    if (compareMode) return;
    var id = $(this).data('id');
    navigateTo(id);
  });

  // ── Click: Favorite star on card ───────────────────────────────────────
  $(document).on('click', '.fav-card-btn', function(e) {
    e.stopPropagation();
    var id = parseInt($(this).data('id'), 10);
    var wasFav = isFavorite(id);
    toggleFavorite(id);
    if (!wasFav) launchConfetti();
    playClickSound();
  });

  // ── Click: Favorite star in detail ─────────────────────────────────────
  $(document).on('click', '.fav-star-btn', function(e) {
    e.stopPropagation();
    var id = parseInt($(this).data('id'), 10);
    var wasFav = isFavorite(id);
    toggleFavorite(id);
    if (!wasFav) launchConfetti();
    playClickSound();
  });

  // ── Click: Recent chip ─────────────────────────────────────────────────
  $(document).on('click', '.recent-chip', function() {
    var id = parseInt($(this).data('id'), 10);
    if (id) navigateTo(id);
  });

  // ── Click: Move filter chip ────────────────────────────────────────────
  $(document).on('click', '.move-filter-chip', function() {
    var filter = $(this).data('filter');
    $('.move-filter-chip').removeClass('active');
    $(this).addClass('active');
    if (filter === 'all') {
      $('.move-row').show();
    } else {
      $('.move-row').each(function() {
        $(this).toggle($(this).data('method') === filter);
      });
    }
  });

  // ── Compare Feature ───────────────────────────────────────────────────
  var compareMode = false;
  var compareSelection = [];

  function updateCompareUI() {
    $('#compare-count').text(compareSelection.length + '/3');
    $('#compare-bar').toggleClass('hidden', !compareMode);
    $('#compare-toggle').toggleClass('active', compareMode);
    $('.cont-pokemon').each(function() {
      var id = parseInt($(this).data('id'), 10);
      $(this).toggleClass('compare-selected', compareSelection.indexOf(id) > -1);
    });
  }

  function showCompareModal() {
    if (compareSelection.length < 2) {
      swal('Compare', 'Select at least 2 Pokémon to compare.', 'info');
      return;
    }
    var statKeys = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
    var statLabels = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
    var html = '';
    compareSelection.forEach(function(id) {
      var p = pokemonCache[id];
      if (!p) return;
      var sprite = getGridSprite(p.sprites) || fallbackSprite(id);
      html += '<div class="compare-card">' +
              '<div class="compare-pkmn-name">' + capitalize(p.name) + '</div>' +
              '<img class="compare-pkmn-sprite" src="' + sprite + '" alt="' + p.name + '">';
      statKeys.forEach(function(key, i) {
        var val = getStat(p.stats, key);
        html += '<div class="compare-stat">' +
                '<span>' + statLabels[i] + '</span>' +
                '<span class="compare-stat-value">' + val + '</span>' +
                '</div>';
      });
      html += '</div>';
    });
    $('#compare-results').html(html);
    $('#compare-modal').removeClass('hidden');
  }

  $('#compare-toggle').on('click', function() {
    compareMode = !compareMode;
    if (!compareMode) {
      compareSelection = [];
    }
    updateCompareUI();
  });

  $('#compare-clear').on('click', function() {
    compareSelection = [];
    updateCompareUI();
  });

  $('#compare-close').on('click', function() {
    $('#compare-modal').addClass('hidden');
  });

  $(document).on('click', '.cont-pokemon', function(e) {
    if (!compareMode) return;
    if ($(e.target).hasClass('fav-card-btn')) return;
    e.stopPropagation();
    var id = parseInt($(this).data('id'), 10);
    var idx = compareSelection.indexOf(id);
    if (idx > -1) {
      compareSelection.splice(idx, 1);
    } else if (compareSelection.length < 3) {
      compareSelection.push(id);
    } else {
      swal('Compare', 'Maximum 3 Pokémon can be compared.', 'info');
      return;
    }
    updateCompareUI();
    if (compareSelection.length >= 2) {
      showCompareModal();
    }
  });

  // ── Damage Calculator ────────────────────────────────────────────────
  function initDamageCalculator() {
    var $attack = $('#damage-attack-type');
    var $defend = $('#damage-defend-type');
    Object.keys(typeColors).forEach(function(typeName) {
      $attack.append('<option value="' + typeName + '">' + capitalize(typeName) + '</option>');
      $defend.append('<option value="' + typeName + '">' + capitalize(typeName) + '</option>');
    });

    $('#damage-toggle').on('click', function() {
      $('#damage-calc').toggleClass('hidden');
      $(this).toggleClass('active');
    });

    $('#damage-calc-btn').on('click', function() {
      var attackType = $attack.val();
      var defendType = $defend.val();
      if (!attackType || !defendType) {
        swal('Damage Calculator', 'Please select both attacking and defending types.', 'info');
        return;
      }
      var mult = 1;
      var chart = defensiveChart[defendType] || {};
      if (chart[attackType] !== undefined) mult = chart[attackType];
      var label = mult === 0 ? '0×' : (mult === 0.25 ? '¼×' : (mult === 0.5 ? '½×' : (mult === 2 ? '2×' : (mult === 4 ? '4×' : '1×'))));
      var color = mult === 0 ? '#ce93d8' : (mult >= 2 ? '#ff6b6b' : (mult < 1 ? '#69f0ae' : '#aaf0ff'));
      $('#damage-result')
        .removeClass('hidden')
        .html(
          '<div>' + capitalize(attackType) + ' vs ' + capitalize(defendType) + '</div>' +
          '<div class="damage-multiplier" style="color:' + color + '">' + label + '</div>'
        );
    });
  }

  initDamageCalculator();

  // ── Click: Shiny toggle ────────────────────────────────────────────────
  $(document).on('click', '.shiny-toggle', function(e) {
    e.stopPropagation();
    toggleShiny();
  });

  // ── Click: Cry button ──────────────────────────────────────────────────
  $(document).on('click', '.cry-btn', function(e) {
    e.stopPropagation();
    if (!currentDetailId) return;
    var p = pokemonCache[currentDetailId];
    if (!p) return;

    // PokeAPI provides cries in the pokemon response (newer versions)
    var cryUrl = null;
    if (p.cries) {
      cryUrl = p.cries.latest || p.cries.legacy || null;
    }
    if (!cryUrl) {
      // Fallback: use pokemoncries.com
      cryUrl = 'https://pokemoncries.com/cries/' + currentDetailId + '.mp3';
    }

    var audio = new Audio(cryUrl);
    audio.volume = 0.6;
    audio.play().catch(function() {
      // Fallback to pokemoncries.com if PokeAPI cry fails
      var fallback = new Audio('https://pokemoncries.com/cries/' + currentDetailId + '.mp3');
      fallback.volume = 0.6;
      fallback.play().catch(function() {
        // Silently ignore — audio may be blocked by browser
      });
    });
  });

  // ── Click: Random Pokémon ──────────────────────────────────────────────
  $('#random-btn').on('click', function() {
    if (allPokemonDetails.length === 0) return;
    var random = allPokemonDetails[Math.floor(Math.random() * allPokemonDetails.length)];
    navigateTo(random.id);
  });

  // ── Click: Prev / Next ─────────────────────────────────────────────────
  $('#prev-btn').on('click', function() {
    if (!currentDetailId) return;
    var ids = allPokemonDetails.map(function(p) { return p.id; }).sort(function(a, b) { return a - b; });
    var idx = ids.indexOf(currentDetailId);
    if (idx > 0) navigateTo(ids[idx - 1]);
  });

  $('#next-btn').on('click', function() {
    if (!currentDetailId) return;
    var ids = allPokemonDetails.map(function(p) { return p.id; }).sort(function(a, b) { return a - b; });
    var idx = ids.indexOf(currentDetailId);
    if (idx >= 0 && idx < ids.length - 1) navigateTo(ids[idx + 1]);
  });

  // ── Click: Back ────────────────────────────────────────────────────────
  $(document).on('click', '.back-btn', function() {
    showListView();
    $('.pokedex-screen').scrollTop(0);
  });

  // ── Click: Evolution node ──────────────────────────────────────────────
  $(document).on('click', '.evo-node', function () {
    var id = parseInt($(this).attr('data-id'), 10);
    if (!id) return;

    // Don't re-navigate if already viewing this pokemon
    var currentNum = parseInt($('.detail-dex-num').text().replace('#', ''), 10);
    if (id === currentNum) return;

    navigateTo(id);
  });

  // ── Keyboard Navigation ────────────────────────────────────────────────
  $(document).on('keydown', function(e) {
    // Ignore if typing in the search input
    if ($(e.target).is('#myInput')) return;
    // Ignore modifier keys
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if ($('#detail-view').hasClass('visible')) {
      // Detail view navigation
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        $('#prev-btn').trigger('click');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        $('#next-btn').trigger('click');
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        showListView();
        $('.pokedex-screen').scrollTop(0);
      }
    } else if ($('#list-view').hasClass('visible')) {
      // List view: Enter opens first visible card
      if (e.key === 'Enter') {
        e.preventDefault();
        var $first = $('#elementos .cont-pokemon').first();
        if ($first.length) navigateTo($first.data('id'));
      } else if (e.key === '/') {
        // Focus search
        e.preventDefault();
        $('#myInput').focus();
      }
    }
  });

});
