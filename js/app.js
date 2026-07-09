$(document).ready(function () {
  // ── Configuration ──────────────────────────────────────────────────────
  var CONCURRENCY = 6;
  var BATCH_SIZE = 30;        // prefetch batch size
  var PRELOAD_MARGIN = 200;   // px before scroll reaches end to trigger prefetch

  // ── Cache ──────────────────────────────────────────────────────────────
  var pokemonCache = {};       // id -> full pokemon detail object
  var speciesCache = {};       // id -> species data (flavor text)
  var evolutionCache = {};     // evolution_chain.url -> chain data
  var pokemonEntries = [];     // raw pokemon_entries from pokedex endpoint
  var allPokemonDetails = [];  // enriched list: { id, name, sprite, types, ... }
  var loadedCount = 0;         // how many pokemon details have been fetched

  // ── Filter State ───────────────────────────────────────────────────────
  var selectedTypes = {};      // { 'fire': true, 'water': true, ... }
  var selectedGen = 'all';     // 'all' or '1'-'9'

  // ── Generation Ranges ──────────────────────────────────────────────────
  var genRanges = {
    1: [1, 151], 2: [152, 251], 3: [252, 386], 4: [387, 493],
    5: [494, 649], 6: [650, 721], 7: [722, 809], 8: [810, 905], 9: [906, 1025]
  };

  // ── Concurrency Control ────────────────────────────────────────────────
  function asyncMapConcurrent(items, fn, concurrency) {
    var results = [];
    var index = 0;
    var active = 0;
    var done = false;

    return new Promise(function (resolve, reject) {
      function startNext() {
        while (active < concurrency && index < items.length) {
          var i = index++;
          active++;
          Promise.resolve(fn(items[i], i)).then(function (val) {
            results[i] = val;
            active--;
            if (index < items.length) {
              startNext();
            } else if (active === 0) {
              done = true;
              resolve(results);
            }
          }).catch(function (err) {
            active--;
            if (!done) {
              done = true;
              reject(err);
            }
          });
        }
      }
      startNext();
    });
  }

  // ── AJAX with 429 Retry ────────────────────────────────────────────────
  function ajaxWithRetry(options, retries) {
    retries = retries || 1;
    return $.ajax(options).then(null, function (jqXHR) {
      if (jqXHR.status === 429 && retries > 0) {
        console.warn('[Pokedex] 429 on ' + options.url + ' — retrying in 2s...');
        var deferred = $.Deferred();
        setTimeout(function () {
          ajaxWithRetry(options, retries - 1).then(deferred.resolve, deferred.reject);
        }, 2000);
        return deferred.promise();
      }
      // Re-throw non-429 or exhausted retries as rejection
      var err = $.Deferred();
      err.reject(jqXHR);
      return err.promise();
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  var typeColors = {
    normal: '#A8A77A', fire: '#EE8130', water: '#6390F0', electric: '#F7D02C',
    grass: '#7AC74C', ice: '#96D9D6', fighting: '#C22E28', poison: '#A33EA1',
    ground: '#E2BF65', flying: '#A98FF3', psychic: '#F95587', bug: '#A6B91A',
    rock: '#B6A136', ghost: '#735797', dragon: '#6F35FC', dark: '#705746',
    steel: '#B7B7CE', fairy: '#D685AD'
  };

  function getStat(statsArr, key) {
    var found = statsArr.find(function (s) { return s.stat.name === key; });
    return found ? found.base_stat : 0;
  }

  function getSprite(sprites) {
    if (!sprites) return '';
    var official = sprites.other && sprites.other['official-artwork'] && sprites.other['official-artwork'].front_default;
    if (official) return official;
    var home = sprites.other && sprites.other.home && sprites.other.home.front_default;
    if (home) return home;
    return sprites.front_default || '';
  }

  function fallbackSprite(id) {
    return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + id + '.png';
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function typeBadges(types) {
    if (!types || types.length === 0) return '';
    return types.map(function (t) {
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

  function showLoading() {
    $('#loading').removeClass('hidden');
  }
  function hideLoading() {
    $('#loading').addClass('hidden');
  }

  // ── Image Lazy Loading (IntersectionObserver) ──────────────────────────

  var imageObserver = null;

  function initImageObserver() {
    if (imageObserver) return;
    if (!window.IntersectionObserver) {
      imageObserver = { observe: function () {} };
      return;
    }
    imageObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var img = entry.target;
          var src = img.getAttribute('data-src');
          if (src) {
            img.removeAttribute('data-src');
            img.src = src;
          }
          imageObserver.unobserve(img);
        }
      });
    }, {
      rootMargin: '200px 0px',
      threshold: 0.01
    });
  }

  function observeImage(img) {
    if (!imageObserver) initImageObserver();
    if (imageObserver && imageObserver.observe) {
      imageObserver.observe(img);
    } else {
      var src = img.getAttribute('data-src');
      if (src) {
        img.removeAttribute('data-src');
        img.src = src;
      }
    }
  }

  // ── Image Error Handler ────────────────────────────────────────────────

  function makeErrorHandler(img, id, name, url, retriesLeft) {
    return function () {
      console.warn('[Pokedex] Image load failed for #' + id + ' ' + name + ': ' + url);
      if (retriesLeft > 0) {
        setTimeout(function () {
          console.log('[Pokedex] Retrying image for #' + id + ' ' + name + '...');
          img.src = url;
          img.onerror = makeErrorHandler(img, id, name, url, retriesLeft - 1);
        }, 1500);
      } else {
        console.warn('[Pokedex] Giving up on image for #' + id + ' ' + name + ' — using placeholder');
        img.src = PLACEHOLDER_SVG;
        img.onerror = null;
      }
    };
  }

  // ── Filtering Logic ────────────────────────────────────────────────────

  function pokemonMatchesFilters(p) {
    // Search filter
    var searchVal = $('#myInput').val().toLowerCase().trim();
    if (searchVal) {
      var nameMatch = p.name.toLowerCase().indexOf(searchVal) > -1;
      var numMatch = p.id.toString().indexOf(searchVal) > -1;
      if (!nameMatch && !numMatch) return false;
    }

    // Type filter (OR logic)
    var typeKeys = Object.keys(selectedTypes);
    if (typeKeys.length > 0) {
      var pokemonTypeNames = (p.types || []).map(function (t) {
        return t.type ? t.type.name : t;
      });
      var matchesType = typeKeys.some(function (key) {
        return pokemonTypeNames.indexOf(key) > -1;
      });
      if (!matchesType) return false;
    }

    // Generation filter
    if (selectedGen !== 'all') {
      var range = genRanges[parseInt(selectedGen)];
      if (range) {
        if (p.id < range[0] || p.id > range[1]) return false;
      }
    }

    return true;
  }

  function applyFilters() {
    var $grid = $('#elementos');
    $grid.empty();

    var filtered = allPokemonDetails.filter(function (p) {
      return pokemonMatchesFilters(p);
    });

    filtered.forEach(function (p) {
      var sprite = getSprite(p.sprites) || fallbackSprite(p.id);
      var displayName = capitalize(p.name);
      var card = '<div class="cont-pokemon" data-id="' + p.id + '">' +
                   '<span class="dex-num">' + dexNum(p.id) + '</span>' +
                   '<img class="img-pkmn" data-src="' + sprite + '" alt="' + displayName + '" loading="lazy">' +
                   '<span class="pkmn-name">' + displayName + '</span>' +
                   '<div class="type-badges">' + typeBadges(p.types) + '</div>' +
                 '</div>';
      $grid.append(card);
    });

    // Attach lazy-load and error handlers to new images
    $('.cont-pokemon .img-pkmn').each(function () {
      var $img = $(this);
      var imgEl = this;
      var id = $img.closest('.cont-pokemon').data('id');
      var name = $img.closest('.cont-pokemon').find('.pkmn-name').text();
      var url = $img.attr('data-src');
      imgEl.onerror = makeErrorHandler(imgEl, id, name, url, 1);
      observeImage(imgEl);
    });

    // After rendering, check if we need to prefetch more
    checkPrefetch();
  }

  // ── Prefetch / Scroll-Aware Loading ────────────────────────────────────

  function checkPrefetch() {
    // How many unique IDs exist among allPokemonDetails (fetched so far)?
    // We want to prefetch more if the user has scrolled near the end of loaded data
    var $grid = $('#elementos');
    var $lastCard = $grid.find('.cont-pokemon').last();
    if ($lastCard.length === 0) return;

    var screen = document.querySelector('.pokedex-screen');
    var lastRect = $lastCard[0].getBoundingClientRect();
    var screenRect = screen.getBoundingClientRect();
    var distanceFromBottom = lastRect.bottom - screenRect.bottom;

    // If the last card is within PRELOAD_MARGIN of being visible, load next batch
    if (distanceFromBottom < PRELOAD_MARGIN && loadedCount < pokemonEntries.length) {
      fetchNextBatch();
    }
  }

  function fetchNextBatch() {
    var start = loadedCount;
    var end = Math.min(loadedCount + BATCH_SIZE, pokemonEntries.length);
    var batch = pokemonEntries.slice(start, end);

    if (batch.length === 0) return;

    showLoading();

    asyncMapConcurrent(batch, function (entry) {
      var id = entry.entry_number;
      // Check if already cached
      if (pokemonCache[id]) {
        return $.Deferred().resolve(pokemonCache[id]).promise();
      }
      return ajaxWithRetry({
        url: 'https://pokeapi.co/api/v2/pokemon/' + id,
        type: 'GET',
        dataType: 'json'
      }, 1).then(function (data) {
        pokemonCache[id] = data;
        // Fire species fetch (fire-and-forget)
        ajaxWithRetry({
          url: 'https://pokeapi.co/api/v2/pokemon-species/' + id,
          type: 'GET',
          dataType: 'json'
        }, 1).then(function (speciesData) {
          speciesCache[id] = speciesData;
          if ($('#detail-view').hasClass('visible') && pokemonCache[id]) {
            renderDetail(id);
          }
        }).fail(function () {});
        return data;
      });
    }, CONCURRENCY).then(function () {
      // Collect newly fetched data
      batch.forEach(function (entry) {
        var id = entry.entry_number;
        var data = pokemonCache[id];
        if (data && !allPokemonDetails.some(function (p) { return p.id === id; })) {
          allPokemonDetails.push({
            id: id,
            name: data.name,
            sprites: data.sprites,
            types: data.types,
            stats: data.stats
          });
        }
      });
      loadedCount = end;
      allPokemonDetails.sort(function (a, b) { return a.id - b.id; });
      applyFilters();
      hideLoading();
    }).catch(function () {
      hideLoading();
    });
  }

  // ── List View ──────────────────────────────────────────────────────────

  function renderList() {
    applyFilters();
  }

  // ── Evolution Chain ────────────────────────────────────────────────────

  function renderEvolutionChain(id) {
    var species = speciesCache[id];
    if (!species || !species.evolution_chain || !species.evolution_chain.url) {
      return '';
    }

    var chainUrl = species.evolution_chain.url;

    // Check cache by URL — if already fetched data, use it
    if (evolutionCache[chainUrl] && !evolutionCache[chainUrl].then) {
      var chainData = evolutionCache[chainUrl];
      if (!chainData || !chainData.chain) return '';
      var chainHtml = buildChainHtml(chainData.chain, id);
      return '<div class="evolution-section"><p class="evo-title">Evolution Chain</p><div class="evolution-chain">' + chainHtml + '</div></div>';
    }

    // If currently fetching (promise stored), show loading placeholder
    // The promise's .then will trigger a re-render when done
    if (!evolutionCache[chainUrl]) {
      evolutionCache[chainUrl] = $.ajax({
        url: chainUrl,
        type: 'GET',
        dataType: 'json'
      }).then(function (data) {
        evolutionCache[chainUrl] = data;
        // Re-render detail view to show chain if still visible
        if ($('#detail-view').hasClass('visible')) {
          var currentId = $('#elementos-pkm').find('.detail-dex-num').text().replace('#', '');
          var currentNum = parseInt(currentId, 10);
          if (currentNum) renderDetail(currentNum);
        }
        return data;
      }).fail(function () {
        evolutionCache[chainUrl] = null;
        return null;
      });
    }

    // Show loading while fetch is in progress
    return '<div class="evolution-section"><p class="evo-title">Evolution Chain</p><p style="color:#888;text-align:center;font-size:10px;">Loading...</p></div>';
  }

  function buildEvoDetailsHtml(details) {
    if (!details || details.length === 0) return 'Evolve';
    var d = details[0];
    var parts = [];

    if (d.min_level) {
      parts.push('Lv.' + d.min_level);
    }
    if (d.item) {
      parts.push(capitalize(d.item.name.replace(/-/g, ' ')));
    } else if (d.held_item) {
      parts.push(capitalize(d.held_item.name.replace(/-/g, ' ')));
    }
    if (d.min_happiness) {
      parts.push('Friendship');
    }
    if (d.trade) {
      parts.push('Trade');
    } else if (d.known_move) {
      parts.push('Knows ' + capitalize(d.known_move.name.replace(/-/g, ' ')));
    }
    if (d.time_of_day) {
      parts.push(capitalize(d.time_of_day));
    }
    if (d.location) {
      parts.push('At ' + capitalize(d.location.name.replace(/-/g, ' ')));
    }
    if (d.min_affection) {
      parts.push('Affection ' + d.min_affection);
    }
    if (d.min_beauty) {
      parts.push('Beauty ' + d.min_beauty);
    }

    return parts.length > 0 ? parts.join(' + ') : 'Evolve';
  }

  function buildChainHtml(chainNode, currentId) {
    // Recursively build HTML for a chain node and its branches
    var current = chainNode.species;
    var speciesName = current.name;
    var speciesId = extractIdFromUrl(current.url);
    var sprite = '';
    if (pokemonCache[speciesId]) {
      sprite = getSprite(pokemonCache[speciesId].sprites) || fallbackSprite(speciesId);
    } else {
      sprite = fallbackSprite(speciesId);
    }

    var isCurrent = (speciesId === currentId);
    var nodeHtml = '<div class="evo-node' + (isCurrent ? ' current' : '') + '" data-id="' + speciesId + '">' +
                   '<img class="evo-sprite" data-src="' + sprite + '" alt="' + speciesName + '" loading="lazy">' +
                   '<span class="evo-name">' + capitalize(speciesName) + '</span>' +
                   '</div>';

    var evolvesTo = chainNode.evolves_to || [];
    if (evolvesTo.length === 0) {
      return nodeHtml;
    }

    // Handle branching
    if (evolvesTo.length === 1) {
      // Linear evolution
      var child = evolvesTo[0];
      var condition = buildEvoDetailsHtml(child.evolution_details);
      var arrowHtml = '<div class="evo-arrow">' +
                      '<span class="arrow-symbol">→</span>' +
                      '<span class="evo-condition">' + condition + '</span>' +
                      '</div>';
      return nodeHtml + arrowHtml + buildChainHtml(child, currentId);
    } else {
      // Branching evolution (multiple children)
      var branchHtml = '<div class="branch-group">';
      evolvesTo.forEach(function (child) {
        var condition = buildEvoDetailsHtml(child.evolution_details);
        var childNodeHtml = buildChainHtml(child, currentId);
        branchHtml += '<div class="branch-row">' +
                      '<div class="evo-arrow">' +
                      '<span class="arrow-symbol">→</span>' +
                      '<span class="evo-condition">' + condition + '</span>' +
                      '</div>' +
                      childNodeHtml +
                      '</div>';
      });
      branchHtml += '</div>';
      return nodeHtml + branchHtml;
    }
  }

  function extractIdFromUrl(url) {
    var parts = url.replace(/\/$/, '').split('/');
    return parseInt(parts[parts.length - 1], 10);
  }

  // ── Detail View ────────────────────────────────────────────────────────

  function renderDetail(id) {
    var p = pokemonCache[id];
    if (!p) return;

    var sprite = getSprite(p.sprites) || fallbackSprite(p.id);
    var displayName = capitalize(p.name);
    var species = speciesCache[id];
    var flavorText = '';
    if (species && species.flavor_text_entries) {
      var entry = species.flavor_text_entries.find(function (e) {
        return e.language.name === 'en';
      });
      if (entry) {
        flavorText = entry.flavor_text.replace(/[\n\f]/g, ' ');
      }
    }

    var statDefs = [
      { key: 'hp', label: 'HP' },
      { key: 'attack', label: 'Attack' },
      { key: 'defense', label: 'Defense' },
      { key: 'special-attack', label: 'Sp. Atk' },
      { key: 'special-defense', label: 'Sp. Def' },
      { key: 'speed', label: 'Speed' }
    ];

    var statBars = statDefs.map(function (s) {
      var val = getStat(p.stats, s.key);
      var pct = Math.min((val / 255) * 100, 100);
      return '<div class="stat-row">' +
               '<span class="stat-label">' + s.label + '</span>' +
               '<div class="stat-bar-bg">' +
                 '<div class="stat-bar-fill" style="width:' + pct + '%"></div>' +
               '</div>' +
               '<span class="stat-value">' + val + '</span>' +
             '</div>';
    }).join('');

    var evoHtml = renderEvolutionChain(id);

    var html = '<div class="info-pokemon">' +
                 '<div class="detail-header">' +
                   '<span class="detail-dex-num">' + dexNum(p.id) + '</span>' +
                   '<h2 class="detail-name">' + displayName + '</h2>' +
                   '<div class="detail-types">' + typeBadges(p.types) + '</div>' +
                 '</div>' +
                 '<div class="detail-sprite-wrap">' +
                   '<img class="specific-info" src="' + sprite + '" alt="' + displayName + '">' +
                 '</div>' +
                 (flavorText ? '<p class="flavor-text">' + flavorText + '</p>' : '') +
                 evoHtml +
                 '<div class="stats-section">' +
                   '<h3 class="stats-title">Base Stats</h3>' +
                   '<div class="stats-bars">' + statBars + '</div>' +
                 '</div>' +
               '</div>';

    $('#elementos-pkm').html(html);

    // Attach lazy-load for evo sprites
    $('.evo-sprite').each(function () {
      var $img = $(this);
      var imgEl = this;
      var src = $img.attr('data-src');
      var $node = $img.closest('.evo-node');
      var name2 = $node.find('.evo-name').text();
      // Try to find the ID from the species URL or else default to 0
      var id2 = parseInt($node.attr('data-id'), 10) || 0;
      imgEl.onerror = makeErrorHandler(imgEl, id2 || 0, name2, src, 1);
      observeImage(imgEl);
    });

    // Attach error handler to detail image
    var $detailImg = $('#elementos-pkm .specific-info');
    if ($detailImg.length) {
      $detailImg[0].onerror = makeErrorHandler($detailImg[0], id, displayName, sprite, 1);
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────

  function showListView() {
    $('#detail-view').removeClass('visible').addClass('hidden');
    $('#list-view').removeClass('hidden').addClass('visible');
    // Re-check scroll for prefetch after layout stabilizes
    setTimeout(checkPrefetch, 100);
  }

  function showDetailView() {
    $('#list-view').removeClass('visible').addClass('hidden');
    $('#detail-view').removeClass('hidden').addClass('visible');
  }

  // ── Fetching (Initial) ─────────────────────────────────────────────────

  function fetchAllPokemonDetails(entries) {
    loadedCount = 0;

    // Load first batch only
    var initialBatch = entries.slice(0, BATCH_SIZE);
    showLoading();

    asyncMapConcurrent(initialBatch, function (entry) {
      var id = entry.entry_number;
      return ajaxWithRetry({
        url: 'https://pokeapi.co/api/v2/pokemon/' + id,
        type: 'GET',
        dataType: 'json'
      }, 1).then(function (data) {
        pokemonCache[id] = data;
        allPokemonDetails.push({
          id: id,
          name: data.name,
          sprites: data.sprites,
          types: data.types,
          stats: data.stats
        });
        // Fire species fetch
        ajaxWithRetry({
          url: 'https://pokeapi.co/api/v2/pokemon-species/' + id,
          type: 'GET',
          dataType: 'json'
        }, 1).then(function (speciesData) {
          speciesCache[id] = speciesData;
          if ($('#detail-view').hasClass('visible') && pokemonCache[id]) {
            renderDetail(id);
          }
        }).fail(function () {});
        return data;
      });
    }, CONCURRENCY)
    .then(function () {
      loadedCount = initialBatch.length;
      allPokemonDetails.sort(function (a, b) { return a.id - b.id; });
      renderList();
      hideLoading();
    })
    .catch(function () {
      hideLoading();
      swal('Error!', 'Failed to load Pokémon data. Please try again.', 'error');
    });
  }

  function fetchPokedex() {
    showLoading();
    $.ajax({
      url: 'https://pokeapi.co/api/v2/pokedex/1',
      type: 'GET',
      dataType: 'json'
    })
    .done(function (response) {
      pokemonEntries = response.pokemon_entries;
      fetchAllPokemonDetails(pokemonEntries);
    })
    .fail(function () {
      hideLoading();
      swal('Error!', 'Could not connect to the Pokédex. Check your connection and try again.', 'error');
    });
  }

  // ── Scroll Listener for Prefetch ───────────────────────────────────────

  $(document).on('scroll', '.pokedex-screen', function () {
    checkPrefetch();
  });

  // ── Search / Filter ────────────────────────────────────────────────────

  $('#myInput').on('keyup', function () {
    applyFilters();
  });

  // ── Type Filter Chips ──────────────────────────────────────────────────

  function initTypeChips() {
    var $container = $('#type-chips');
    $container.empty();
    var typeNames = Object.keys(typeColors);
    typeNames.forEach(function (typeName) {
      var color = typeColors[typeName];
      var $chip = $('<button class="type-chip" data-type="' + typeName + '" style="background:' + color + '">' + capitalize(typeName) + '</button>');
      $chip.on('click', function () {
        $(this).toggleClass('active');
        if ($(this).hasClass('active')) {
          selectedTypes[typeName] = true;
        } else {
          delete selectedTypes[typeName];
        }
        applyFilters();
      });
      $container.append($chip);
    });
  }

  $('#clear-types').on('click', function () {
    $('.type-chip').removeClass('active');
    selectedTypes = {};
    applyFilters();
  });

  // ── Generation Filter Chips ────────────────────────────────────────────

  $(document).on('click', '.gen-chip', function () {
    if ($(this).hasClass('active')) return;
    $('.gen-chip').removeClass('active');
    $(this).addClass('active');
    selectedGen = $(this).data('gen');
    applyFilters();
  });

  // ── Click: List Card → Detail ──────────────────────────────────────────

  $(document).on('click', '.cont-pokemon', function () {
    var id = $(this).data('id');
    showLoading();
    if (pokemonCache[id]) {
      renderDetail(id);
      hideLoading();
      showDetailView();
    } else {
      ajaxWithRetry({
        url: 'https://pokeapi.co/api/v2/pokemon/' + id,
        type: 'GET',
        dataType: 'json'
      }, 1)
      .done(function (data) {
        pokemonCache[id] = data;
        renderDetail(id);
        hideLoading();
        showDetailView();
      })
      .fail(function () {
        hideLoading();
        swal('Error!', 'Could not load Pokémon details.', 'error');
      });
    }
  });

  // ── Click: Back Button ─────────────────────────────────────────────────

  $(document).on('click', '.back-btn', function () {
    showListView();
    $('.pokedex-screen').scrollTop(0);
  });

  // ── Init ───────────────────────────────────────────────────────────────

  initTypeChips();
  fetchPokedex();
});