const express = require('express');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const db = require('../db-loader');
const { authenticateToken } = require('./auth');
const appSettings = require('../utils/app-settings');
const { getRankingTournamentNumbers } = require('./settings');

const router = express.Router();

// Get organization logo as buffer from database (for Excel exports)
async function getOrganizationLogoBuffer() {
  return new Promise((resolve) => {
    db.get('SELECT file_data, content_type FROM organization_logo ORDER BY created_at DESC LIMIT 1', [], (err, row) => {
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
    SELECT tournament_number FROM tournaments
    WHERE category_id = $1 AND season = $2 AND tournament_number IN (${rankingNumbersSQL})
      AND ($3::int IS NULL OR organization_id = $3)
  `;

  db.all(tournamentsPlayedQuery, [categoryId, season, orgId], (err, tournamentRows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const tournamentsPlayed = {};
    rankingNumbers.forEach(num => {
      tournamentsPlayed[`t${num}`] = tournamentRows.some(t => t.tournament_number === num);
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
            averageBonusTiers = (await appSettings.getOrgSetting(orgId, 'average_bonus_tiers')) === 'true';
          }
        }
      } catch (e) { /* default to standard */ }

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
              rankings: rows, tournamentsPlayed, qualificationMode, averageBonusTiers,
              bonusColumns: [...seenTypes].map(rt => ({ ruleType: rt, label: labelMap[rt] || rt }))
            });
          }
        );
      } else {
        res.json({ rankings: rows, tournamentsPlayed, qualificationMode, averageBonusTiers, bonusColumns: [] });
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
        const logoBuffer = await getOrganizationLogoBuffer();
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

module.exports = router;
