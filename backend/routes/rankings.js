const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const db = require('../db-loader');
const { authenticateToken } = require('./auth');
const appSettings = require('../utils/app-settings');
const { getRankingTournamentNumbers } = require('./settings');

const router = express.Router();

// Get organization logo as buffer from database (for Excel exports)
async function getOrganizationLogoBuffer(orgId) {
  return new Promise((resolve) => {
    const query = orgId
      ? 'SELECT file_data, content_type FROM organization_logo WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1'
      : 'SELECT file_data, content_type FROM organization_logo ORDER BY created_at DESC LIMIT 1';
    const params = orgId ? [orgId] : [];
    db.get(query, params, (err, row) => {
      if (err || !row) {
        // Fallback to static French billiard icon
        const fallbackPath = path.join(__dirname, '../../frontend/images/FrenchBillard-Icon-small.png');
        if (fs.existsSync(fallbackPath)) {
          resolve(fs.readFileSync(fallbackPath));
        } else {
          resolve(null);
        }
        return;
      }
      const buffer = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
      resolve(buffer);
    });
  });
}

// Get rankings by category and season
router.get('/', authenticateToken, async (req, res) => {
  const { categoryId, season } = req.query;

  if (!categoryId || !season) {
    return res.status(400).json({ error: 'Category ID and season required' });
  }

  const orgId = req.user.organizationId || null;
  const rankingNumbers = await getRankingTournamentNumbers(orgId);
  const rankingNumbersSQL = rankingNumbers.join(',');

  // First, check which tournaments have been played for this category/season
  const tournamentsPlayedQuery = `
    SELECT tournament_number, id FROM tournaments
    WHERE category_id = $1 AND season = $2 AND tournament_number IN (${rankingNumbersSQL})
      AND ($3::int IS NULL OR organization_id = $3)
  `;

  db.all(tournamentsPlayedQuery, [categoryId, season, orgId], (err, tournamentRows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const tournamentsPlayed = {};
    const tournamentIds = {};
    rankingNumbers.forEach(num => {
      tournamentsPlayed[`t${num}`] = tournamentRows.some(t => t.tournament_number === num);
      const match = tournamentRows.find(t => t.tournament_number === num);
      if (match) tournamentIds[`t${num}`] = match.id;
    });

    // Use LEFT JOIN for players to include ranked players even if not in players table
    // Get player name from tournament_results as fallback
    // Use subqueries for club_aliases and clubs to avoid duplicate rows from JOINs
    // Include email/telephone from player_contacts for finale convocations
    const query = `
      SELECT * FROM (
        SELECT DISTINCT ON (r.licence)
          r.rank_position,
          r.licence,
          COALESCE(p.first_name, (SELECT MAX(tr.player_name) FROM tournament_results tr WHERE REPLACE(tr.licence, ' ', '') = r.licence)) as first_name,
          COALESCE(p.last_name, '') as last_name,
          COALESCE(
            (SELECT canonical_name FROM club_aliases WHERE UPPER(REPLACE(REPLACE(REPLACE(alias, ' ', ''), '.', ''), '-', ''))
             = UPPER(REPLACE(REPLACE(REPLACE(COALESCE(p.club, ''), ' ', ''), '.', ''), '-', '')) LIMIT 1),
            p.club, 'Non renseigné'
          ) as club,
          r.total_match_points,
          COALESCE(r.total_bonus_points, 0) as total_bonus_points,
          COALESCE(r.bonus_detail, '{}') as bonus_detail,
          r.avg_moyenne,
          r.best_serie,
          r.tournament_1_points,
          r.tournament_2_points,
          r.tournament_3_points,
          COALESCE(r.position_points_detail, '{}') as position_points_detail,
          COALESCE(r.average_bonus, 0) as average_bonus,
          c.game_type,
          c.level,
          c.display_name,
          (SELECT logo_filename FROM clubs WHERE UPPER(REPLACE(REPLACE(REPLACE(name, ' ', ''), '.', ''), '-', ''))
           = UPPER(REPLACE(REPLACE(REPLACE(COALESCE(
             (SELECT canonical_name FROM club_aliases WHERE UPPER(REPLACE(REPLACE(REPLACE(alias, ' ', ''), '.', ''), '-', ''))
              = UPPER(REPLACE(REPLACE(REPLACE(COALESCE(p.club, ''), ' ', ''), '.', ''), '-', '')) LIMIT 1),
             p.club, ''), ' ', ''), '.', ''), '-', '')) LIMIT 1) as club_logo,
          COALESCE((SELECT SUM(tr.points) FROM tournament_results tr
                    JOIN tournaments t ON tr.tournament_id = t.id
                    WHERE REPLACE(tr.licence, ' ', '') = REPLACE(r.licence, ' ', '')
                    AND t.category_id = r.category_id
                    AND t.season = r.season
                    AND t.tournament_number IN (${rankingNumbersSQL})), 0) as cumulated_points,
          COALESCE((SELECT SUM(tr.reprises) FROM tournament_results tr
                    JOIN tournaments t ON tr.tournament_id = t.id
                    WHERE REPLACE(tr.licence, ' ', '') = REPLACE(r.licence, ' ', '')
                    AND t.category_id = r.category_id
                    AND t.season = r.season
                    AND t.tournament_number IN (${rankingNumbersSQL})), 0) as cumulated_reprises,
          CASE WHEN p.licence IS NULL THEN 1 ELSE 0 END as missing_from_players,
          pc.email as contact_email,
          pc.telephone as contact_telephone
        FROM rankings r
        LEFT JOIN players p ON REPLACE(r.licence, ' ', '') = REPLACE(p.licence, ' ', '')
        LEFT JOIN player_contacts pc ON REPLACE(r.licence, ' ', '') = REPLACE(pc.licence, ' ', '')
        JOIN categories c ON r.category_id = c.id
        WHERE r.category_id = $1 AND r.season = $2
          AND ($3::int IS NULL OR r.organization_id = $3)
        ORDER BY r.licence, r.rank_position
      ) sub
      ORDER BY rank_position
    `;

    db.all(query, [categoryId, season, orgId], async (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Determine qualification mode and settings for this org
      let qualificationMode = 'standard';
      let averageBonusTiers = false;
      try {
        if (orgId) {
          const mode = await appSettings.getOrgSetting(orgId, 'qualification_mode');
          if (mode) qualificationMode = mode;
          if (qualificationMode === 'journees') {
            const avgBonusSetting = (await appSettings.getOrgSetting(orgId, 'average_bonus_tiers')) === 'true';
            const bonusMoyenneEnabled = (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled')) === 'true';
            // When bonus moyenne is applied at tournament level (baked into position_points),
            // don't show season-level average bonus column — it would be double-counting
            averageBonusTiers = avgBonusSetting && !bonusMoyenneEnabled;
          }
        }
      } catch (e) { /* default to standard */ }

      // Fetch journées settings for the frontend
      let bestOfCount = 0; // 0 = all tournaments count (standard mode default)
      let journeesCount = 3;
      let qualificationSettings = { threshold: 9, small: 4, large: 6 };
      try {
        if (orgId) {
          if (qualificationMode === 'journees') {
            const bocVal = parseInt(await appSettings.getOrgSetting(orgId, 'best_of_count'), 10);
            bestOfCount = isNaN(bocVal) ? 2 : bocVal; // default 2 for journées
          }
          journeesCount = parseInt(await appSettings.getOrgSetting(orgId, 'journees_count')) || 3;
          const qSettings = await appSettings.getOrgSettingsBatch(orgId, [
            'qualification_threshold', 'qualification_small', 'qualification_large'
          ]);
          qualificationSettings = {
            threshold: parseInt(qSettings.qualification_threshold, 10) || 9,
            small: parseInt(qSettings.qualification_small, 10) || 4,
            large: parseInt(qSettings.qualification_large, 10) || 6
          };
        }
      } catch (e) { /* defaults above */ }
      console.log(`[RANKINGS API] org=${orgId}, qualificationMode=${qualificationMode}, bestOfCount=${bestOfCount}`);

      // Build bonusMoyenneInfo for the frontend info card
      let bonusMoyenneInfo = null;
      try {
        if (orgId) {
          const bonusEnabled = (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_enabled')) === 'true';
          if (bonusEnabled) {
            const bonusType = (await appSettings.getOrgSetting(orgId, 'bonus_moyenne_type')) || 'normal';
            const tier1 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_1')) || 1;
            const tier2 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_2')) || 2;
            const tier3 = parseInt(await appSettings.getOrgSetting(orgId, 'scoring_avg_tier_3')) || 3;
            // Get game_parameters for this category
            const cat = await new Promise((resolve, reject) => {
              db.get('SELECT game_type, level, organization_id FROM categories WHERE id = $1', [categoryId], (err, row) => err ? reject(err) : resolve(row));
            });
            if (cat) {
              const gp = await new Promise((resolve, reject) => {
                db.get(
                  "SELECT moyenne_mini, moyenne_maxi FROM game_parameters WHERE UPPER(REPLACE(mode, ' ', '')) = UPPER(REPLACE($1, ' ', '')) AND UPPER(categorie) = UPPER($2) AND ($3::int IS NULL OR organization_id = $3)",
                  [cat.game_type, cat.level, cat.organization_id || orgId],
                  (err, row) => err ? reject(err) : resolve(row)
                );
              });
              const mini = gp ? parseFloat(gp.moyenne_mini) : 0;
              const maxi = gp ? parseFloat(gp.moyenne_maxi) : 999;
              const middle = (mini + maxi) / 2;
              bonusMoyenneInfo = { enabled: true, type: bonusType, mini, middle, maxi, tiers: [tier1, tier2, tier3] };
            }
          }
        }
      } catch (e) { /* ignore — info card is optional */ }

      // Extract bonus column metadata from rankings' bonus_detail
      const seenTypes = new Set();
      let hasLegacyBonus = false;
      (rows || []).forEach(r => {
        if (r.bonus_detail && r.bonus_detail !== '{}') {
          try {
            const detail = JSON.parse(r.bonus_detail);
            Object.keys(detail).forEach(k => { if (detail[k] > 0) seenTypes.add(k); });
          } catch (e) {}
        }
        // Backward compat: rankings with total_bonus_points but no bonus_detail (pre-rule-engine)
        if ((!r.bonus_detail || r.bonus_detail === '{}') && r.total_bonus_points > 0) hasLegacyBonus = true;
      });

      // Backfill legacy rankings: inject bonus_detail from total_bonus_points
      if (hasLegacyBonus && seenTypes.size === 0) {
        seenTypes.add('MOYENNE_BONUS');
        (rows || []).forEach(r => {
          if ((!r.bonus_detail || r.bonus_detail === '{}') && r.total_bonus_points > 0) {
            r.bonus_detail = JSON.stringify({ MOYENNE_BONUS: r.total_bonus_points });
          }
        });
      }

      if (seenTypes.size > 0) {
        const typesArr = [...seenTypes];
        const placeholders = typesArr.map((_, i) => `$${i + 1}`).join(',');
        const orgParam = typesArr.length + 1;
        db.all(
          `SELECT DISTINCT rule_type, column_label FROM scoring_rules WHERE rule_type IN (${placeholders}) AND column_label IS NOT NULL AND ($${orgParam}::int IS NULL OR organization_id = $${orgParam})`,
          [...typesArr, orgId],
          (err2, labelRows) => {
            const labelMap = {};
            (labelRows || []).forEach(r => { labelMap[r.rule_type] = r.column_label; });
            res.json({
              rankings: rows, tournamentsPlayed, tournamentIds, qualificationMode, averageBonusTiers, bonusMoyenneInfo,
              bestOfCount, journeesCount, qualificationSettings,
              bonusColumns: [...seenTypes].map(rt => ({ ruleType: rt, label: labelMap[rt] || rt }))
            });
          }
        );
      } else {
        res.json({ rankings: rows, tournamentsPlayed, tournamentIds, qualificationMode, averageBonusTiers, bonusMoyenneInfo, bestOfCount, journeesCount, qualificationSettings, bonusColumns: [] });
      }
    });
  });
});

// Get all seasons
router.get('/seasons', authenticateToken, (req, res) => {
  const orgId = req.user.organizationId || null;
  db.all('SELECT DISTINCT season FROM tournaments WHERE ($1::int IS NULL OR organization_id = $1) ORDER BY season DESC', [orgId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows.map(r => r.season));
  });
});

// Export rankings to Excel
router.get('/export', authenticateToken, async (req, res) => {
  const { categoryId, season } = req.query;

  if (!categoryId || !season) {
    return res.status(400).json({ error: 'Category ID and season required' });
  }

  const orgId = req.user.organizationId || null;
  const rankingNumbers = await getRankingTournamentNumbers(orgId);
  const rankingNumbersSQL = rankingNumbers.join(',');

  // First, check which tournaments have been played
  const tournamentsPlayedQuery = `
    SELECT tournament_number FROM tournaments
    WHERE category_id = $1 AND season = $2 AND tournament_number IN (${rankingNumbersSQL})
      AND ($3::int IS NULL OR organization_id = $3)
  `;

  const tournamentRows = await new Promise((resolve, reject) => {
    db.all(tournamentsPlayedQuery, [categoryId, season, orgId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

  const tournamentsPlayed = {};
  rankingNumbers.forEach(num => {
    tournamentsPlayed[`t${num}`] = tournamentRows.some(t => t.tournament_number === num);
  });

  // Use LEFT JOIN for players to include ranked players even if not in players table
  // Use subqueries for club_aliases and clubs to avoid duplicate rows from JOINs
  const query = `
    SELECT * FROM (
      SELECT DISTINCT ON (r.licence)
        r.rank_position,
        r.licence,
        COALESCE(p.first_name, (SELECT MAX(tr.player_name) FROM tournament_results tr WHERE REPLACE(tr.licence, ' ', '') = r.licence)) as first_name,
        COALESCE(p.last_name, '') as last_name,
        COALESCE(
          (SELECT canonical_name FROM club_aliases WHERE UPPER(REPLACE(REPLACE(REPLACE(alias, ' ', ''), '.', ''), '-', ''))
           = UPPER(REPLACE(REPLACE(REPLACE(COALESCE(p.club, ''), ' ', ''), '.', ''), '-', '')) LIMIT 1),
          p.club, 'Non renseigné'
        ) as club,
        r.total_match_points,
        COALESCE(r.total_bonus_points, 0) as total_bonus_points,
        COALESCE(r.bonus_detail, '{}') as bonus_detail,
        r.avg_moyenne,
        r.best_serie,
        r.tournament_1_points,
        r.tournament_2_points,
        r.tournament_3_points,
        COALESCE(r.position_points_detail, '{}') as position_points_detail,
        c.game_type,
        c.level,
        c.display_name,
        (SELECT logo_filename FROM clubs WHERE UPPER(REPLACE(REPLACE(REPLACE(name, ' ', ''), '.', ''), '-', ''))
         = UPPER(REPLACE(REPLACE(REPLACE(COALESCE(
           (SELECT canonical_name FROM club_aliases WHERE UPPER(REPLACE(REPLACE(REPLACE(alias, ' ', ''), '.', ''), '-', ''))
            = UPPER(REPLACE(REPLACE(REPLACE(COALESCE(p.club, ''), ' ', ''), '.', ''), '-', '')) LIMIT 1),
           p.club, ''), ' ', ''), '.', ''), '-', '')) LIMIT 1) as club_logo,
        COALESCE((SELECT SUM(tr.points) FROM tournament_results tr
                  JOIN tournaments t ON tr.tournament_id = t.id
                  WHERE REPLACE(tr.licence, ' ', '') = REPLACE(r.licence, ' ', '')
                  AND t.category_id = r.category_id
                  AND t.season = r.season
                  AND t.tournament_number IN (${rankingNumbersSQL})), 0) as cumulated_points,
        COALESCE((SELECT SUM(tr.reprises) FROM tournament_results tr
                  JOIN tournaments t ON tr.tournament_id = t.id
                  WHERE REPLACE(tr.licence, ' ', '') = REPLACE(r.licence, ' ', '')
                  AND t.category_id = r.category_id
                  AND t.season = r.season
                  AND t.tournament_number IN (${rankingNumbersSQL})), 0) as cumulated_reprises
      FROM rankings r
      LEFT JOIN players p ON REPLACE(r.licence, ' ', '') = REPLACE(p.licence, ' ', '')
      JOIN categories c ON r.category_id = c.id
      WHERE r.category_id = $1 AND r.season = $2
        AND ($3::int IS NULL OR r.organization_id = $3)
      ORDER BY r.licence, r.rank_position
    ) sub
    ORDER BY rank_position
  `;

  db.all(query, [categoryId, season, orgId], async (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No rankings found' });
    }

    try {
      // Parse bonus_detail to find dynamic bonus columns
      const seenTypes = new Set();
      let hasLegacyBonus = false;
      (rows || []).forEach(r => {
        if (r.bonus_detail && r.bonus_detail !== '{}') {
          try {
            const detail = JSON.parse(r.bonus_detail);
            Object.keys(detail).forEach(k => { if (detail[k] > 0) seenTypes.add(k); });
          } catch(e) {}
        }
        if ((!r.bonus_detail || r.bonus_detail === '{}') && r.total_bonus_points > 0) hasLegacyBonus = true;
      });

      // Backfill legacy rankings for Excel export
      if (hasLegacyBonus && seenTypes.size === 0) {
        seenTypes.add('MOYENNE_BONUS');
        (rows || []).forEach(r => {
          if ((!r.bonus_detail || r.bonus_detail === '{}') && r.total_bonus_points > 0) {
            r.bonus_detail = JSON.stringify({ MOYENNE_BONUS: r.total_bonus_points });
          }
        });
      }

      let bonusColumns = [];
      if (seenTypes.size > 0) {
        const typesArr = [...seenTypes];
        const placeholders = typesArr.map((_, i) => `$${i + 1}`).join(',');
        const orgParam = typesArr.length + 1;
        const labelRows = await new Promise((resolve, reject) => {
          db.all(
            `SELECT DISTINCT rule_type, column_label FROM scoring_rules WHERE rule_type IN (${placeholders}) AND column_label IS NOT NULL AND ($${orgParam}::int IS NULL OR organization_id = $${orgParam})`,
            [...typesArr, orgId],
            (err, rows) => { if (err) reject(err); else resolve(rows || []); }
          );
        });
        const labelMap = {};
        labelRows.forEach(r => { labelMap[r.rule_type] = r.column_label; });
        bonusColumns = [...seenTypes].map(rt => ({ ruleType: rt, label: labelMap[rt] || rt }));
      }

      const hasBonusCols = bonusColumns.length > 0;
      // Base cols: Position, Licence, Prénom, Nom, Club, Logo, T1, T2, T3, Pts Match, Total, Total Points, Total Reprises, Moyenne, Meilleure Série = 15
      // + bonus columns (inserted between Pts Match and Total)
      const totalExcelCols = 15 + bonusColumns.length;
      const lastColLetter = String.fromCharCode(64 + totalExcelCols);

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Classement');

      const categoryName = rows[0].display_name;

      // Add organization logo
      try {
        const logoBuffer = await getOrganizationLogoBuffer(orgId);
        if (logoBuffer) {
          const imageId = workbook.addImage({
            buffer: logoBuffer,
            extension: 'png',
          });
          worksheet.addImage(imageId, {
            tl: { col: 0, row: 0 },
            ext: { width: 80, height: 45 }
          });
        }
      } catch (err) {
        console.log('Logo not found for Excel:', err.message);
      }

      // Title - Row 1
      worksheet.mergeCells(`B1:${lastColLetter}1`);
      worksheet.getCell('B1').value = `CLASSEMENT ${categoryName.toUpperCase()}`;
      worksheet.getCell('B1').font = { size: 18, bold: true, color: { argb: 'FF1F4788' } };
      worksheet.getCell('B1').alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getCell('B1').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7F3FF' }
      };
      worksheet.getCell('A1').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7F3FF' }
      };
      worksheet.getRow(1).height = 35;

      // Subtitle - Row 2
      worksheet.mergeCells(`A2:${lastColLetter}2`);
      const exportDate = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
      worksheet.getCell('A2').value = `Saison ${season} • Exporté le ${exportDate}`;
      worksheet.getCell('A2').font = { size: 11, italic: true, color: { argb: 'FF666666' } };
      worksheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(2).height = 20;

      // Headers - Row 4
      const headerValues = [
        'Position',
        'Licence',
        'Prénom',
        'Nom',
        'Club',
        '', // Empty header for logo column
        'T1',
        'T2',
        'T3',
        'Pts Match'
      ];
      if (hasBonusCols) {
        bonusColumns.forEach(col => headerValues.push(col.label));
      }
      headerValues.push('Total', 'Total Points', 'Total Reprises', 'Moyenne', 'Meilleure Série');
      worksheet.getRow(4).values = headerValues;
      worksheet.getRow(4).height = 28;
      for (let col = 1; col <= totalExcelCols; col++) {
        const cell = worksheet.getRow(4).getCell(col);
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1F4788' }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          bottom: { style: 'medium', color: { argb: 'FF1F4788' } }
        };
      }

      // Helper to format tournament points:
      // - Tournament not played → "-"
      // - Tournament played but player absent (null) → "*"
      // - Tournament played and player participated → show points
      const formatTournamentPoints = (points, tournamentPlayed) => {
        if (!tournamentPlayed) return '-';
        if (points === null) return '*';
        return points;
      };

      // Check if legend is needed (any absent players from PLAYED tournaments)
      const hasAbsentPlayers = rows.some(r =>
        (tournamentsPlayed.t1 && r.tournament_1_points === null) ||
        (tournamentsPlayed.t2 && r.tournament_2_points === null) ||
        (tournamentsPlayed.t3 && r.tournament_3_points === null)
      );

      // Add legend if needed
      if (hasAbsentPlayers) {
        worksheet.mergeCells(`A3:${lastColLetter}3`);
        worksheet.getCell('A3').value = '(*) Non-participation au tournoi concerné';
        worksheet.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF666666' } };
        worksheet.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle' };
      }

      // Calculate number of qualified players for the final
      // Rule: < 9 players → 4 qualified, >= 9 players → 6 qualified
      const totalPlayers = rows.length;
      const qualifiedCount = totalPlayers < 9 ? 4 : 6;

      // Data
      rows.forEach((row, index) => {
        const moyenne = row.cumulated_reprises > 0
          ? (row.cumulated_points / row.cumulated_reprises).toFixed(3)
          : '0.000';

        const bonusDetail = (() => { try { return JSON.parse(row.bonus_detail || '{}'); } catch(e) { return {}; } })();
        const totalBonus = Object.values(bonusDetail).reduce((s, v) => s + (v || 0), 0);
        const pureMatchPoints = row.total_match_points - totalBonus;

        // Parse kept tournaments for best-of styling
        let keptSet = null;
        if (row.position_points_detail && row.position_points_detail !== '{}') {
          try {
            const ppd = JSON.parse(row.position_points_detail);
            if (ppd.kept && ppd.kept.length > 0) keptSet = new Set(ppd.kept.map(Number));
          } catch(e) {}
        }

        const rowValues = [
          row.rank_position,
          row.licence,
          row.first_name,
          row.last_name,
          row.club,
          '', // Empty cell for logo
          formatTournamentPoints(row.tournament_1_points, tournamentsPlayed.t1),
          formatTournamentPoints(row.tournament_2_points, tournamentsPlayed.t2),
          formatTournamentPoints(row.tournament_3_points, tournamentsPlayed.t3),
          pureMatchPoints
        ];
        if (hasBonusCols) {
          bonusColumns.forEach(col => rowValues.push(bonusDetail[col.ruleType] || 0));
        }
        rowValues.push(row.total_match_points, row.cumulated_points, row.cumulated_reprises, moyenne, row.best_serie || 0);

        const excelRow = worksheet.addRow(rowValues);

        // Green highlighting for qualified players
        if (row.rank_position <= qualifiedCount) {
          for (let col = 1; col <= totalExcelCols; col++) {
            excelRow.getCell(col).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE8F5E9' }  // Light green
            };
            excelRow.getCell(col).font = { bold: true, size: 11 };
          }
          // Green position number
          excelRow.getCell(1).font = { bold: true, size: 11, color: { argb: 'FF2E7D32' } };
          excelRow.getCell(1).value = `✓ ${row.rank_position}`;
        } else {
          // Alternate row colors for non-qualified
          const bgColor = index % 2 === 0 ? 'FFF8F9FA' : 'FFFFFFFF';
          for (let col = 1; col <= totalExcelCols; col++) {
            excelRow.getCell(col).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: bgColor }
            };
          }
        }

        // Center alignment for numeric columns and logo column
        for (let col = 1; col <= totalExcelCols; col++) {
          if (![2, 3, 4, 5].includes(col)) {
            excelRow.getCell(col).alignment = { horizontal: 'center', vertical: 'middle' };
          }
        }

        // Left alignment for licence, names, and club
        [2, 3, 4, 5].forEach(col => {
          excelRow.getCell(col).alignment = { horizontal: 'left', vertical: 'middle' };
        });

        // Best-of styling: bold for kept, strikethrough for dropped tournament scores
        if (keptSet) {
          const tournamentCols = [7, 8, 9]; // T1, T2, T3 Excel columns
          const tournamentNumbers = [1, 2, 3];
          const isQualified = row.rank_position <= qualifiedCount;
          tournamentCols.forEach((col, i) => {
            const tn = tournamentNumbers[i];
            const cell = excelRow.getCell(col);
            const cellVal = [row.tournament_1_points, row.tournament_2_points, row.tournament_3_points][i];
            if (cellVal !== null && cellVal !== undefined) {
              if (keptSet.has(tn)) {
                cell.font = { bold: true, size: 11 };
              } else {
                cell.font = { strike: true, color: { argb: 'FF999999' }, size: 11 };
              }
              // Preserve green background for qualified
              if (isQualified) {
                cell.font = { ...cell.font, color: keptSet.has(tn) ? undefined : { argb: 'FF999999' } };
              }
            }
          });
        }

        // Add row height
        excelRow.height = 22;

        // Add club logo in dedicated logo column if available
        if (row.club_logo) {
          const clubLogoPath = path.join(__dirname, '../../frontend/images/clubs', row.club_logo);
          if (fs.existsSync(clubLogoPath)) {
            try {
              const logoImageId = workbook.addImage({
                filename: clubLogoPath,
                extension: row.club_logo.split('.').pop(),
              });

              // Position logo in dedicated Logo column (column F)
              const rowNumber = excelRow.number;
              worksheet.addImage(logoImageId, {
                tl: { col: 5.1, row: rowNumber - 1 + 0.15 },
                ext: { width: 18, height: 18 }
              });
            } catch (err) {
              console.log(`Could not add club logo for ${row.first_name} ${row.last_name}:`, err.message);
            }
          }
        }
      });

      // Column widths
      const colWidths = [
        { width: 12 },  // Position
        { width: 15 },  // Licence
        { width: 18 },  // Prénom
        { width: 18 },  // Nom
        { width: 32 },  // Club
        { width: 4 },   // Logo
        { width: 8 },   // T1
        { width: 8 },   // T2
        { width: 8 },   // T3
        { width: 12 }   // Pts Match
      ];
      if (hasBonusCols) {
        bonusColumns.forEach(() => colWidths.push({ width: 12 })); // Bonus columns
      }
      colWidths.push(
        { width: 10 },  // Total
        { width: 12 },  // Total Points
        { width: 14 },  // Total Reprises
        { width: 12 },  // Moyenne
        { width: 14 }   // Meilleure Série
      );
      worksheet.columns = colWidths;

      // Borders for all data cells
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber >= 4) {
          row.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
              left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
              bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
              right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
            };
          });
        }
      });

      // Send file
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );

      // Create filename: "Classement Bande R2, 2025-2026.xlsx"
      const filename = `Classement ${categoryName}, ${season}.xlsx`;

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );

      await workbook.xlsx.write(res);
      res.end();

    } catch (error) {
      console.error('Excel export error:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

// Get player eligibility report (accessible to all authenticated users)
router.get('/eligibility', authenticateToken, async (req, res) => {
  try {
    const { season } = req.query;
    const orgId = req.user.organizationId || null;

    if (!season) {
      return res.status(400).json({ error: 'Season required' });
    }

    const rankingNumbers = await getRankingTournamentNumbers(orgId);

    // Fallback if no ranking numbers configured
    if (!rankingNumbers || rankingNumbers.length === 0) {
      return res.json([]);
    }

    // Build dynamic IN clause with proper parameterization
    const rankingPlaceholders = rankingNumbers.map((_, i) => `$${i + 3}`).join(',');

    // Get all players who have played at least one tournament in the season
    const query = `
      SELECT
        p.licence,
        p.first_name,
        p.last_name,
        p.club,
        c.game_type as mode,
        c.level as categorie,
        c.id as category_id,
        SUM(tr.points) as total_points,
        SUM(tr.reprises) as total_reprises,
        CAST(SUM(tr.points) AS FLOAT) / NULLIF(SUM(tr.reprises), 0) as moyenne_saison,
        COUNT(DISTINCT t.id) as nb_tournaments,
        gp.moyenne_mini,
        gp.moyenne_maxi
      FROM tournament_results tr
      JOIN tournaments t ON tr.tournament_id = t.id
      JOIN categories c ON t.category_id = c.id
      JOIN players p ON tr.licence = p.licence
      LEFT JOIN game_parameters gp ON
        UPPER(REPLACE(c.game_type, ' ', '')) LIKE UPPER(REPLACE(gp.mode, ' ', '')) || '%'
        AND UPPER(TRIM(gp.categorie)) = UPPER(TRIM(c.level))
        AND ($2::int IS NULL OR gp.organization_id = $2)
      WHERE t.season = $1
        AND t.tournament_number IN (` + rankingPlaceholders + `)
        AND ($2::int IS NULL OR t.organization_id = $2)
        AND UPPER(p.licence) NOT LIKE 'TEST%'
      GROUP BY
        p.licence, p.first_name, p.last_name, p.club,
        c.game_type, c.level, c.id,
        gp.moyenne_mini, gp.moyenne_maxi
      HAVING COUNT(DISTINCT t.id) >= 1
      ORDER BY c.game_type, c.level, moyenne_saison DESC
    `;

    const params = [season, orgId, ...rankingNumbers];

    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Enrich with eligibility status
      const enriched = rows.map(row => {
        const moy = row.moyenne_saison;
        const min = row.moyenne_mini;
        const max = row.moyenne_maxi;

        let status = 'maintien';
        let status_label = 'Maintien';
        let suggested_category = row.categorie;
        let emoji = '🟢';

        if (!min || !max) {
          // No thresholds configured
          status = 'non_configure';
          status_label = 'Non configuré';
          emoji = '⚪';
        } else if (moy > max) {
          // Must move up
          status = 'montee_obligatoire';
          status_label = 'Montée obligatoire';
          emoji = '🔴';
          suggested_category = getSuggestedCategory(row.mode, row.categorie, 'up');
        } else if (moy < min) {
          // Should move down
          status = 'descente_suggeree';
          status_label = 'Descente suggérée';
          emoji = '🟠';
          suggested_category = getSuggestedCategory(row.mode, row.categorie, 'down');
        } else if (moy > max * 0.9) {
          // Close to upper limit
          status = 'proche_montee';
          status_label = 'Proche montée';
          emoji = '🔵';
        } else if (moy < min * 1.1) {
          // Close to lower limit
          status = 'proche_descente';
          status_label = 'Proche descente';
          emoji = '⚫';
        }

        return {
          ...row,
          moyenne_saison: moy ? parseFloat(moy.toFixed(2)) : 0,
          status,
          status_label,
          status_emoji: emoji,
          suggested_category
        };
      });

      res.json(enriched);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to determine eligibility status
function determineEligibilityStatus(moyenne, min, max) {
  if (!min || !max) {
    return {
      status: 'non_configure',
      label: 'Non configuré',
      emoji: '⚪',
      direction: null
    };
  }

  if (moyenne > max) {
    return {
      status: 'montee_obligatoire',
      label: 'Montée obligatoire',
      emoji: '🔴',
      direction: 'up'
    };
  } else if (moyenne < min) {
    return {
      status: 'descente_suggeree',
      label: 'Descente suggérée',
      emoji: '🟠',
      direction: 'down'
    };
  } else if (moyenne > max * 0.9) {
    return {
      status: 'proche_montee',
      label: 'Proche montée',
      emoji: '🔵',
      direction: null
    };
  } else if (moyenne < min * 1.1) {
    return {
      status: 'proche_descente',
      label: 'Proche descente',
      emoji: '⚫',
      direction: null
    };
  } else {
    return {
      status: 'maintien',
      label: 'Maintien',
      emoji: '🟢',
      direction: null
    };
  }
}

// Helper function to suggest next category (up or down)
function getSuggestedCategory(mode, currentLevel, direction) {
  // FFB ranking hierarchy (from highest to lowest)
  const hierarchy = ['N1', 'N2', 'N3', 'R1', 'R2', 'R3', 'R4', 'R5', 'D1', 'D2', 'D3', 'NC'];

  const currentIndex = hierarchy.indexOf(currentLevel);
  if (currentIndex === -1) return currentLevel; // Not found

  if (direction === 'up') {
    return currentIndex > 0 ? hierarchy[currentIndex - 1] : currentLevel;
  } else {
    return currentIndex < hierarchy.length - 1 ? hierarchy[currentIndex + 1] : currentLevel;
  }
}

// Export eligibility data to Excel
router.get('/eligibility/export', authenticateToken, async (req, res) => {
  const { season } = req.query;

  if (!season) {
    return res.status(400).json({ error: 'Season required' });
  }

  try {
    const orgId = req.user.organizationId || null;

    // Get the same eligibility data as the report
    const rankingNumbers = await getRankingTournamentNumbers(orgId);
    const rankingPlaceholders = rankingNumbers.map((_, idx) => `$${idx + 3}`).join(',');
    const queryParams = [season, orgId, ...rankingNumbers];

    const query = `
      SELECT
        p.licence,
        p.first_name,
        p.last_name,
        p.club,
        c.game_type as mode,
        c.level as categorie,
        c.id as category_id,
        SUM(tr.points) as total_points,
        SUM(tr.reprises) as total_reprises,
        CAST(SUM(tr.points) AS FLOAT) / NULLIF(SUM(tr.reprises), 0) as moyenne_saison,
        COUNT(DISTINCT t.id) as nb_tournaments,
        gp.moyenne_mini,
        gp.moyenne_maxi
      FROM tournament_results tr
      JOIN tournaments t ON tr.tournament_id = t.id
      JOIN categories c ON t.category_id = c.id
      JOIN players p ON tr.licence = p.licence
      LEFT JOIN game_parameters gp ON
        UPPER(REPLACE(c.game_type, ' ', '')) LIKE UPPER(REPLACE(gp.mode, ' ', '')) || '%'
        AND UPPER(TRIM(gp.categorie)) = UPPER(TRIM(c.level))
        AND ($2::int IS NULL OR gp.organization_id = $2)
      WHERE t.season = $1
        AND t.tournament_number IN (` + rankingPlaceholders + `)
        AND ($2::int IS NULL OR t.organization_id = $2)
        AND UPPER(p.licence) NOT LIKE 'TEST%'
      GROUP BY p.licence, p.first_name, p.last_name, p.club, c.game_type, c.level, c.id, gp.moyenne_mini, gp.moyenne_maxi
      HAVING COUNT(DISTINCT t.id) > 0
      ORDER BY c.game_type, c.level, moyenne_saison DESC
    `;

    const rows = await new Promise((resolve, reject) => {
      db.all(query, queryParams, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Process each row to add status and suggested category
    const processedData = rows.map(row => {
      const status = determineEligibilityStatus(row.moyenne_saison, row.moyenne_mini, row.moyenne_maxi);
      const suggestedCategory = getSuggestedCategory(row.mode, row.categorie, status.direction);

      return {
        ...row,
        status: status.status,
        status_label: status.label,
        suggested_category: suggestedCategory,
        moyenne_saison: row.moyenne_saison || 0
      };
    });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Éligibilité');

    // Define columns
    worksheet.columns = [
      { header: 'Licence', key: 'licence', width: 12 },
      { header: 'Prénom', key: 'first_name', width: 15 },
      { header: 'Nom', key: 'last_name', width: 15 },
      { header: 'Club', key: 'club', width: 30 },
      { header: 'Mode', key: 'mode', width: 12 },
      { header: 'Cat. actuelle', key: 'categorie', width: 12 },
      { header: 'Moy. saison', key: 'moyenne_saison', width: 12 },
      { header: 'Moy. Min', key: 'moyenne_mini', width: 12 },
      { header: 'Moy. Max', key: 'moyenne_maxi', width: 12 },
      { header: 'Statut', key: 'status_label', width: 20 },
      { header: 'Cat. suggérée', key: 'suggested_category', width: 12 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4788' }
    };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // Add data rows with conditional formatting
    processedData.forEach(row => {
      const excelRow = worksheet.addRow({
        licence: row.licence,
        first_name: row.first_name,
        last_name: row.last_name,
        club: row.club || '-',
        mode: row.mode,
        categorie: row.categorie,
        moyenne_saison: row.moyenne_saison ? row.moyenne_saison.toFixed(2) : '-',
        moyenne_mini: row.moyenne_mini || '-',
        moyenne_maxi: row.moyenne_maxi || '-',
        status_label: row.status_label,
        suggested_category: row.suggested_category
      });

      // Color-code status column based on status
      const statusCell = excelRow.getCell('status_label');
      if (row.status === 'montee_obligatoire') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDC3545' }
        };
        statusCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      } else if (row.status === 'descente_suggeree') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFC107' }
        };
      } else if (row.status === 'proche_montee') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2196F3' }
        };
        statusCell.font = { color: { argb: 'FFFFFFFF' } };
      } else if (row.status === 'maintien') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF28A745' }
        };
        statusCell.font = { color: { argb: 'FFFFFFFF' } };
      }
    });

    // Generate filename
    const filename = `Eligibilite_Joueurs_${season.replace('/', '-')}.xlsx`;

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('[Eligibility Export] Error:', error);
    res.status(500).json({ error: 'Export failed', details: error.message });
  }
});

// Export eligibility data to PDF
router.get('/eligibility/export-pdf', authenticateToken, async (req, res) => {
  const { season } = req.query;

  if (!season) {
    return res.status(400).json({ error: 'Season required' });
  }

  try {
    const orgId = req.user.organizationId || null;

    // Get the same eligibility data as the Excel export
    const rankingNumbers = await getRankingTournamentNumbers(orgId);
    const rankingPlaceholders = rankingNumbers.map((_, idx) => `$${idx + 3}`).join(',');
    const queryParams = [season, orgId, ...rankingNumbers];

    const query = `
      SELECT
        p.licence,
        p.first_name,
        p.last_name,
        p.club,
        c.game_type as mode,
        c.level as categorie,
        c.id as category_id,
        SUM(tr.points) as total_points,
        SUM(tr.reprises) as total_reprises,
        CAST(SUM(tr.points) AS FLOAT) / NULLIF(SUM(tr.reprises), 0) as moyenne_saison,
        COUNT(DISTINCT t.id) as nb_tournaments,
        gp.moyenne_mini,
        gp.moyenne_maxi
      FROM tournament_results tr
      JOIN tournaments t ON tr.tournament_id = t.id
      JOIN categories c ON t.category_id = c.id
      JOIN players p ON tr.licence = p.licence
      LEFT JOIN game_parameters gp ON
        UPPER(REPLACE(c.game_type, ' ', '')) LIKE UPPER(REPLACE(gp.mode, ' ', '')) || '%'
        AND UPPER(TRIM(gp.categorie)) = UPPER(TRIM(c.level))
        AND ($2::int IS NULL OR gp.organization_id = $2)
      WHERE t.season = $1
        AND t.tournament_number IN (` + rankingPlaceholders + `)
        AND ($2::int IS NULL OR t.organization_id = $2)
        AND UPPER(p.licence) NOT LIKE 'TEST%'
      GROUP BY p.licence, p.first_name, p.last_name, p.club, c.game_type, c.level, c.id, gp.moyenne_mini, gp.moyenne_maxi
      HAVING COUNT(DISTINCT t.id) > 0
      ORDER BY c.game_type, c.level, moyenne_saison DESC
    `;

    const rows = await new Promise((resolve, reject) => {
      db.all(query, queryParams, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Process each row
    const processedData = rows.map(row => {
      const status = determineEligibilityStatus(row.moyenne_saison, row.moyenne_mini, row.moyenne_maxi);
      const suggestedCategory = getSuggestedCategory(row.mode, row.categorie, status.direction);

      return {
        ...row,
        status: status.status,
        status_label: status.label,
        suggested_category: suggestedCategory,
        moyenne_saison: row.moyenne_saison || 0
      };
    });

    // Create PDF using PDFKit
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });

    // Set response headers
    const filename = `Eligibilite_Joueurs_${season.replace('/', '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Pipe PDF to response
    doc.pipe(res);

    // Title
    doc.fontSize(16).font('Helvetica-Bold').text(`Éligibilité des joueurs - Saison ${season}`, 30, 30);

    // Summary stats
    const total = processedData.length;
    const maintien = processedData.filter(d => ['maintien', 'proche_montee', 'proche_descente'].includes(d.status)).length;
    const montee = processedData.filter(d => d.status === 'montee_obligatoire').length;
    const descente = processedData.filter(d => d.status === 'descente_suggeree').length;
    doc.fontSize(10).font('Helvetica').text(
      `Total: ${total} joueurs  |  Maintien: ${maintien}  |  Montée: ${montee}  |  Descente: ${descente}`,
      30, 55
    );

    // Table header
    let y = 80;
    const colWidths = [100, 110, 40, 22, 22, 22, 22, 70, 22];
    const headers = ['Joueur', 'Club', 'Mode', 'Cat.', 'Moy.', 'Min', 'Max', 'Statut', 'Sugg.'];

    doc.fontSize(8).font('Helvetica-Bold');
    let x = 30;
    headers.forEach((header, i) => {
      doc.rect(x, y, colWidths[i], 15).fillAndStroke('#1F4788', '#1F4788');
      doc.fillColor('white').text(header, x + 2, y + 4, { width: colWidths[i] - 4, align: 'left' });
      x += colWidths[i];
    });

    // Table rows
    y += 15;
    doc.font('Helvetica').fontSize(6.5);

    processedData.forEach((row, index) => {
      if (y > 530) { // New page if needed
        doc.addPage();
        y = 30;
      }

      // Status color
      let bgColor = '#FFFFFF';
      let textColor = '#000000';
      if (row.status === 'montee_obligatoire') {
        bgColor = '#DC3545';
        textColor = '#FFFFFF';
      } else if (row.status === 'descente_suggeree') {
        bgColor = '#FFC107';
      } else if (row.status === 'proche_montee') {
        bgColor = '#2196F3';
        textColor = '#FFFFFF';
      } else if (row.status === 'maintien') {
        bgColor = '#28A745';
        textColor = '#FFFFFF';
      }

      const rowData = [
        `${row.first_name} ${row.last_name}`,
        row.club || '-',
        row.mode,
        row.categorie,
        row.moyenne_saison ? row.moyenne_saison.toFixed(2) : '-',
        row.moyenne_mini || '-',
        row.moyenne_maxi || '-',
        row.status_label,
        row.suggested_category
      ];

      x = 30;
      rowData.forEach((cell, i) => {
        // Background for status column
        if (i === 7) {
          doc.rect(x, y, colWidths[i], 12).fillAndStroke(bgColor, '#CCCCCC');
          doc.fillColor(textColor);
        } else {
          doc.rect(x, y, colWidths[i], 12).stroke('#CCCCCC');
          doc.fillColor('#000000');
        }
        doc.text(String(cell), x + 2, y + 3, {
          width: colWidths[i] - 4,
          height: 10,
          align: 'left',
          ellipsis: true,
          lineBreak: false
        });
        x += colWidths[i];
      });

      y += 12;
    });

    // Finalize PDF
    doc.end();

  } catch (error) {
    console.error('[Eligibility PDF Export] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'PDF export failed', details: error.message });
    }
  }
});

module.exports = router;
