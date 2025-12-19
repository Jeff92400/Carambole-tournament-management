# CDBHS Tournament Management - Architecture Diagrams

## System Overview

```mermaid
graph TB
    subgraph Frontend["Frontend (Static HTML + JS)"]
        Pages[HTML Pages]
        JS[JavaScript]
        Fetch[Fetch API + JWT]
    end

    subgraph Backend["Backend (Node.js/Express)"]
        Server[Express Server]
        Routes[Route Handlers]
        Auth[JWT Authentication]
        Scheduler[Email Scheduler]
    end

    subgraph Database["Database (PostgreSQL)"]
        Users[(users)]
        Players[(players)]
        Tournaments[(tournaments)]
        Rankings[(rankings)]
        Clubs[(clubs)]
        Inscriptions[(inscriptions)]
        Emails[(email_campaigns)]
    end

    subgraph External["External Services"]
        Resend[Resend Email API]
    end

    Pages --> JS
    JS --> Fetch
    Fetch -->|REST API + JSON| Server
    Server --> Auth
    Auth --> Routes
    Routes -->|SQL| Users
    Routes -->|SQL| Players
    Routes -->|SQL| Tournaments
    Routes -->|SQL| Rankings
    Routes -->|SQL| Clubs
    Routes -->|SQL| Inscriptions
    Routes -->|SQL| Emails
    Scheduler -->|SMTP| Resend

    style Frontend fill:#d1fae5,stroke:#10b981
    style Backend fill:#dbeafe,stroke:#3b82f6
    style Database fill:#ede9fe,stroke:#8b5cf6
    style External fill:#fef3c7,stroke:#f59e0b
```

## Frontend Pages

```mermaid
graph LR
    subgraph Pages["Application Pages - Navigation Order"]
        P1["1. Login"]
        P2["2. Dashboard"]
        P3["3. Calendar"]
        P4["4. Players List"]
        P5["5. Rankings"]
        P6["6. Tournaments List"]
        P7["7. Tournament Results"]
        P8["8. Clubs"]
        P9["9. Inscriptions"]
        P10["10. Emailing"]
        P11["11. Statistics"]
        P12["12. Settings"]
    end

    subgraph Import["Import Pages"]
        I1["Import Players"]
        I2["Import Tournament"]
        I3["Import External"]
    end

    subgraph Tools["Tools"]
        T1["Generate Poules"]
        T2["Player History"]
    end

    P1 --> P2
    P2 --> P3
    P3 --> P4
    P4 --> P5
    P5 --> P6
    P6 --> P7
    P7 --> P8
    P8 --> P9
    P9 --> P10
    P10 --> P11
    P11 --> P12

    style P1 fill:#fecaca,stroke:#ef4444
    style P2 fill:#fef3c7,stroke:#f59e0b
    style P4 fill:#d1fae5,stroke:#10b981
    style P5 fill:#dbeafe,stroke:#3b82f6
    style P6 fill:#ede9fe,stroke:#8b5cf6
    style P10 fill:#fce7f3,stroke:#ec4899
```

## Pages to Database Tables Mapping

```mermaid
graph TB
    subgraph Pages["Frontend Pages"]
        P1["1. Login"]
        P2["2. Dashboard"]
        P3["3. Calendar"]
        P4["4. Players List"]
        P5["5. Rankings"]
        P6["6. Tournaments"]
        P7["7. Results"]
        P8["8. Clubs"]
        P9["9. Inscriptions"]
        P10["10. Emailing"]
        P11["11. Statistics"]
        P12["12. Settings"]
    end

    subgraph Tables["Database Tables"]
        DB1[(users)]
        DB2[(players)]
        DB3[(categories)]
        DB4[(tournaments)]
        DB5[(tournament_results)]
        DB6[(rankings)]
        DB7[(clubs)]
        DB8[(club_aliases)]
        DB9[(inscriptions)]
        DB10[(tournoi_ext)]
        DB11[(calendar)]
        DB12[(player_contacts)]
        DB13[(email_campaigns)]
        DB14[(email_templates)]
        DB15[(scheduled_emails)]
        DB16[(game_parameters)]
        DB17[(mode_mapping)]
        DB18[(import_history)]
    end

    P1 -->|auth| DB1

    P2 -->|read| DB2
    P2 -->|read| DB4
    P2 -->|read| DB6

    P3 -->|CRUD| DB11
    P3 -->|read| DB4

    P4 -->|CRUD| DB2
    P4 -->|read| DB3
    P4 -->|read| DB7

    P5 -->|read/write| DB6
    P5 -->|read| DB2
    P5 -->|read| DB3

    P6 -->|CRUD| DB4
    P6 -->|read| DB3

    P7 -->|CRUD| DB5
    P7 -->|read| DB4
    P7 -->|read| DB2

    P8 -->|CRUD| DB7
    P8 -->|CRUD| DB8

    P9 -->|CRUD| DB9
    P9 -->|read| DB10
    P9 -->|read| DB2

    P10 -->|CRUD| DB12
    P10 -->|CRUD| DB13
    P10 -->|CRUD| DB14
    P10 -->|CRUD| DB15

    P11 -->|read| DB2
    P11 -->|read| DB4
    P11 -->|read| DB5

    P12 -->|CRUD| DB16
    P12 -->|CRUD| DB17
    P12 -->|read| DB18

    style P1 fill:#fecaca,stroke:#ef4444
    style P2 fill:#fef3c7,stroke:#f59e0b
    style P4 fill:#d1fae5,stroke:#10b981
    style P5 fill:#dbeafe,stroke:#3b82f6
    style P10 fill:#fce7f3,stroke:#ec4899

    style DB1 fill:#fee2e2,stroke:#ef4444
    style DB2 fill:#d1fae5,stroke:#10b981
    style DB4 fill:#ede9fe,stroke:#8b5cf6
    style DB6 fill:#dbeafe,stroke:#3b82f6
    style DB13 fill:#fce7f3,stroke:#ec4899
```

## Database Tables Summary

| Table | Description | Used By |
|-------|-------------|---------|
| `users` | Admin accounts & authentication | Login |
| `players` | Player profiles (name, license, category, club) | Players List, Rankings, Results, Statistics |
| `categories` | Player categories (R1-R6, Nationale, etc.) | Players, Rankings, Tournaments |
| `tournaments` | Tournament definitions (name, date, mode, category) | Tournaments List, Calendar, Dashboard |
| `tournament_results` | Match results (winner, loser, scores, points) | Tournament Results, Rankings, Statistics |
| `rankings` | Computed rankings by mode/category | Rankings, Dashboard |
| `clubs` | Club definitions (name, code) | Players, Clubs |
| `club_aliases` | Alternative club names for matching | Import, Clubs |
| `inscriptions` | Tournament registrations | Inscriptions List |
| `tournoi_ext` | External tournaments (federation) | Inscriptions |
| `calendar` | Calendar events | Calendar |
| `player_contacts` | Email contacts synced from players | Emailing |
| `email_campaigns` | Email campaign tracking | Emailing |
| `email_templates` | Reusable email templates | Emailing |
| `scheduled_emails` | Scheduled emails queue | Email Scheduler |
| `game_parameters` | Billiard game parameters per mode | Settings |
| `mode_mapping` | Mode name mappings | Settings, Import |
| `import_history` | Import audit trail | Settings |

## API Routes

```mermaid
graph TD
    subgraph Auth["/api/auth"]
        A1[POST /login]
        A2[POST /register]
        A3[GET /users]
        A4[POST /change-password]
    end

    subgraph Players["/api/players"]
        P1[GET /]
        P2[POST /]
        P3[PUT /:id]
        P4[DELETE /:id]
        P5[GET /:id/history]
        P6[POST /sync-contacts]
    end

    subgraph Tournaments["/api/tournaments"]
        T1[GET /]
        T2[POST /]
        T3[PUT /:id]
        T4[DELETE /:id]
        T5[GET /:id/results]
        T6[POST /:id/results]
    end

    subgraph Rankings["/api/rankings"]
        R1[GET /]
        R2[POST /calculate]
        R3[GET /export]
    end

    subgraph Calendar["/api/calendar"]
        C1[GET /]
        C2[POST /]
        C3[PUT /:id]
        C4[DELETE /:id]
    end

    subgraph Clubs["/api/clubs"]
        CL1[GET /]
        CL2[POST /]
        CL3[PUT /:id]
        CL4[DELETE /:id]
        CL5[GET /aliases]
        CL6[POST /aliases]
    end

    subgraph Inscriptions["/api/inscriptions"]
        I1[GET /]
        I2[POST /]
        I3[DELETE /:id]
        I4[GET /external-tournaments]
    end

    subgraph Emailing["/api/emailing"]
        E1[GET /contacts]
        E2[POST /campaigns]
        E3[GET /templates]
        E4[POST /send]
        E5[POST /schedule]
    end

    subgraph Statistics["/api/statistics"]
        S1[GET /overview]
        S2[GET /by-player]
        S3[GET /by-club]
    end

    subgraph Settings["/api/settings"]
        ST1[GET /parameters]
        ST2[POST /parameters]
        ST3[GET /modes]
    end

    subgraph Backup["/api/backup"]
        B1[GET /export]
        B2[POST /import]
    end

    style Auth fill:#fecaca,stroke:#ef4444
    style Players fill:#d1fae5,stroke:#10b981
    style Tournaments fill:#ede9fe,stroke:#8b5cf6
    style Rankings fill:#dbeafe,stroke:#3b82f6
    style Emailing fill:#fce7f3,stroke:#ec4899
    style Settings fill:#fef3c7,stroke:#f59e0b
```

## Database Schema

```mermaid
erDiagram
    users ||--o{ players : manages
    players ||--o{ tournament_results : participates
    players }o--|| clubs : belongs_to
    players }o--|| categories : has
    tournaments ||--o{ tournament_results : contains
    tournaments }o--|| categories : for
    rankings }o--|| players : ranks
    rankings }o--|| categories : by
    inscriptions }o--|| players : registers
    inscriptions }o--|| tournoi_ext : for
    player_contacts ||--|| players : synced_from
    email_campaigns ||--o{ scheduled_emails : triggers
    clubs ||--o{ club_aliases : has

    users {
        int id PK
        string username
        string password
        string role
        timestamp created_at
    }

    players {
        int id PK
        string first_name
        string last_name
        string license_number
        int club_id FK
        int category_id FK
        string email
        string phone
        boolean is_active
        timestamp created_at
    }

    categories {
        int id PK
        string name
        string code
        int level
    }

    tournaments {
        int id PK
        string name
        date tournament_date
        string mode
        int category_id FK
        string location
        string status
        timestamp created_at
    }

    tournament_results {
        int id PK
        int tournament_id FK
        int winner_id FK
        int loser_id FK
        int winner_score
        int loser_score
        float winner_points
        float loser_points
        int round
        timestamp created_at
    }

    rankings {
        int id PK
        int player_id FK
        int category_id FK
        string mode
        float total_points
        int tournaments_played
        int rank
        string season
    }

    clubs {
        int id PK
        string name
        string code
        string city
        boolean is_active
    }

    club_aliases {
        int id PK
        int club_id FK
        string alias_name
    }

    inscriptions {
        int id PK
        int player_id FK
        int tournoi_ext_id FK
        string status
        timestamp created_at
    }

    tournoi_ext {
        int id PK
        string name
        date tournament_date
        string mode
        string category
        string location
        string federation_url
    }

    calendar {
        int id PK
        string title
        date event_date
        string event_type
        string description
    }

    player_contacts {
        int id PK
        int player_id FK
        string first_name
        string last_name
        string email
        string club
        boolean is_subscribed
    }

    email_campaigns {
        int id PK
        string name
        string subject
        string body
        string status
        int sent_count
        timestamp created_at
    }

    email_templates {
        int id PK
        string name
        string subject
        string body
    }

    scheduled_emails {
        int id PK
        int campaign_id FK
        string recipient_ids
        string subject
        string body
        string image_url
        timestamp scheduled_at
        string status
        timestamp sent_at
    }

    game_parameters {
        int id PK
        string mode
        string category
        float points_win
        float points_loss
        int target_score
    }

    mode_mapping {
        int id PK
        string external_name
        string internal_name
    }

    import_history {
        int id PK
        string import_type
        string filename
        int records_imported
        timestamp imported_at
    }
```

## Billiard Game Modes

```mermaid
graph LR
    subgraph Modes["Game Modes"]
        M1["Libre"]
        M2["Bande"]
        M3["3 Bandes"]
        M4["Cadre"]
    end

    subgraph Categories["Player Categories"]
        C1["R1 - Debutant"]
        C2["R2"]
        C3["R3"]
        C4["R4"]
        C5["R5"]
        C6["R6 - Expert"]
        C7["Nationale"]
    end

    M1 --> C1
    M1 --> C2
    M1 --> C3
    M2 --> C3
    M2 --> C4
    M3 --> C4
    M3 --> C5
    M3 --> C6
    M4 --> C5
    M4 --> C6
    M4 --> C7

    style M1 fill:#d1fae5,stroke:#10b981
    style M2 fill:#dbeafe,stroke:#3b82f6
    style M3 fill:#ede9fe,stroke:#8b5cf6
    style M4 fill:#fef3c7,stroke:#f59e0b
```

## Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant API
    participant DB

    User->>Browser: Enter credentials
    Browser->>API: POST /api/auth/login
    API->>DB: SELECT user WHERE username
    DB-->>API: User record
    API->>API: Bcrypt verify password
    API->>API: Generate JWT token
    API-->>Browser: {token, user, role}
    Browser->>Browser: Store in localStorage

    Note over Browser: All subsequent requests

    Browser->>API: GET /api/players
    Note over Browser,API: Authorization: Bearer {token}
    API->>API: Validate JWT
    API->>DB: SELECT players
    DB-->>API: Players data
    API-->>Browser: JSON response
```

## Email Campaign Flow

```mermaid
sequenceDiagram
    participant Admin
    participant Frontend
    participant API
    participant Scheduler
    participant Resend
    participant Recipients

    Admin->>Frontend: Create campaign
    Frontend->>API: POST /api/emailing/campaigns
    API->>API: Save campaign

    alt Immediate Send
        API->>Resend: Send emails
        Resend->>Recipients: Deliver emails
    else Scheduled Send
        API->>API: Create scheduled_emails
        Note over Scheduler: Every 60 seconds
        Scheduler->>API: Check pending emails
        API-->>Scheduler: Due emails
        Scheduler->>Resend: Send batch
        Resend->>Recipients: Deliver emails
        Scheduler->>API: Update status
    end

    API-->>Frontend: Campaign status
    Frontend-->>Admin: Show results
```

## Deployment Architecture

```mermaid
graph TB
    subgraph Railway["Railway Platform"]
        subgraph Service["Node.js Service"]
            Express[Express Server]
            Static[Static Files<br/>/frontend/*]
            Scheduler[Email Scheduler]
        end

        subgraph PG["PostgreSQL"]
            DB[(Database)]
        end
    end

    subgraph External["External Services"]
        Resend[Resend Email API]
    end

    subgraph Client["Client Browser"]
        Browser[Web Browser]
    end

    Browser -->|HTTPS| Express
    Express -->|Serve| Static
    Express -->|SQL| DB
    Scheduler -->|API| Resend

    style Railway fill:#1e1e2e,stroke:#cba6f7,color:#fff
    style Service fill:#313244,stroke:#89b4fa,color:#fff
    style PG fill:#313244,stroke:#a6e3a1,color:#fff
    style External fill:#fef3c7,stroke:#f59e0b
    style Client fill:#f5f5f5,stroke:#666
```

---

## How to View These Diagrams

1. **GitHub**: Push this file to your repo - GitHub renders Mermaid automatically
2. **VS Code**: Install "Markdown Preview Mermaid Support" extension
3. **Online**: Paste diagrams at [mermaid.live](https://mermaid.live)
4. **Obsidian**: Native Mermaid support in notes
