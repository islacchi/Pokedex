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

  function applyFilters() {
    var $grid    = $('#elementos');
    var filtered = allPokemonDetails.filter(pokemonMatchesFilters);
    filtered = sortPokemon(filtered);

    // Show/hide no-results message
    if (filtered.length === 0) {
      $('#no-results').removeClass('hidden');
    } else {
      $('#no-results').addClass('hidden');
    }

    // Build HTML in one string — avoids N separate DOM insertions
    var html = '';
    filtered.forEach(function(p) {
      var sprite      = getGridSprite(p.sprites) || fallbackSprite(p.id);
      var displayName = capitalize(p.name);
      var favClass    = isFavorite(p.id) ? ' active' : '';
      html += '<div class="cont-pokemon" data-id="' + p.id + '">' +
                '<span class="dex-num">' + dexNum(p.id) + '</span>' +
                '<button class="fav-card-btn' + favClass + '" data-id="' + p.id + '" title="Toggle favorite">★</button>' +
                '<img class="img-pkmn" data-src="' + sprite + '" src="' + PLACEHOLDER_SVG + '" alt="' + displayName + '" loading="lazy">' +
                '<span class="pkmn-name">' + displayName + '</span>' +
                '<div class="type-badges">' + typeBadges(p.types) + '</div>' +
              '</div>';
    });
    $grid.html(html); // single DOM write

    // Attach lazy-load and error handlers
    $grid.find('.img-pkmn').each(function() {
      var imgEl = this;
      var $card = $(this).closest('.cont-pokemon');
      var id    = $card.data('id');
      var name  = $card.find('.pkmn-name').text();
      var url   = $(this).attr('data-src');
      imgEl.onerror = makeErrorHandler(imgEl, id, name, url, 1);
      observeImage(imgEl);
    });

    setTimeout(checkPrefetch, 50);
  }

  // ── Prefetch / Scroll-Aware Loading ────────────────────────────────────
  var prefetchThrottleTimer = null;

  function checkPrefetch() {
    if (isLoadingBatch) return;
    if (loadedCount >= pokemonEntries.length) return;

    var $grid     = $('#elementos');
    var $lastCard = $grid.find('.cont-pokemon').last();
    if (!$lastCard.length) return;

    var screen    = document.querySelector('.pokedex-screen');
    var lastRect  = $lastCard[0].getBoundingClientRect();
    var screenRect = screen.getBoundingClientRect();

    if ((lastRect.bottom - screenRect.bottom) < PRELOAD_MARGIN) {
      fetchNextBatch();
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

    showLoading();

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
      hideLoading();
      persistCaches(); // persist after every batch
    })
    .catch(function() {
      isLoadingBatch = false;
      hideLoading();
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
        '</div>' +
        (flavorText ? '<p class="flavor-text">' + flavorText + '</p>' : '') +
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
        '<div class="evolution-section" id="evo-section">' +
          '<p class="evo-loading" style="color:#888;text-align:center;font-size:10px;font-family:\'Press Start 2P\',monospace;">Loading evolution…</p>' +
        '</div>' +
        '<div class="stats-section">' +
          '<h3 class="stats-title">Base Stats</h3>' +
          '<div class="stats-bars">' + statBars + '</div>' +
        '</div>' +
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
    setTimeout(checkPrefetch, 100);
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
    showLoading();

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
      hideLoading();
      persistCaches();
    })
    .catch(function() {
      hideLoading();
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
  initTypeChips();
  loadFavorites();

  // Hydrate from localStorage; skip network on return visits
  var wasCached = hydrateCaches();
  if (wasCached && pokemonEntries.length > 0) {
    bootstrapFromCache();
    applyFilters();
  } else {
    fetchPokedex();
  }

  // ── Scroll Listener (throttled) ────────────────────────────────────────
  $('.pokedex-screen').on('scroll', throttledCheckPrefetch);

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

  // ── Click: Card → Detail ───────────────────────────────────────────────
  $(document).on('click', '.cont-pokemon', function(e) {
    // Don't trigger when clicking the favorite star
    if ($(e.target).hasClass('fav-card-btn')) return;
    var id = $(this).data('id');
    navigateTo(id);
  });

  // ── Click: Favorite star on card ───────────────────────────────────────
  $(document).on('click', '.fav-card-btn', function(e) {
    e.stopPropagation();
    var id = parseInt($(this).data('id'), 10);
    toggleFavorite(id);
  });

  // ── Click: Favorite star in detail ─────────────────────────────────────
  $(document).on('click', '.fav-star-btn', function(e) {
    e.stopPropagation();
    var id = parseInt($(this).data('id'), 10);
    toggleFavorite(id);
  });

  // ── Click: Shiny toggle ────────────────────────────────────────────────
  $(document).on('click', '.shiny-toggle', function(e) {
    e.stopPropagation();
    toggleShiny();
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

});