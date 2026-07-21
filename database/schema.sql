-- LocalHands Database Schema
-- MySQL 8.x

CREATE DATABASE IF NOT EXISTS localhands CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE localhands;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('citizen','volunteer','helper','admin') DEFAULT 'citizen',
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  trust_score DECIMAL(5,2) DEFAULT 0.00,
  volunteer_points INT DEFAULT 0,
  fcm_token TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_role (role),
  INDEX idx_trust_score (trust_score)
) ENGINE=InnoDB;

-- User Profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(15),
  photo_url TEXT,
  date_of_birth DATE,
  gender ENUM('male','female','other','prefer_not_to_say'),
  district VARCHAR(100),
  area VARCHAR(100),
  pincode VARCHAR(10),
  address TEXT,
  bio TEXT,
  upi_id VARCHAR(100),
  bank_account_holder VARCHAR(255),
  bank_account_number VARCHAR(50),
  bank_ifsc VARCHAR(20),
  emergency_contact_name VARCHAR(255),
  emergency_contact_phone VARCHAR(15),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  volunteer_hours INT DEFAULT 0,
  response_rate DECIMAL(5,2) DEFAULT 0.00,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_district (district),
  INDEX idx_pincode (pincode)
) ENGINE=InnoDB;

-- User Skills
CREATE TABLE IF NOT EXISTS user_skills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  skill VARCHAR(100) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_skill (user_id, skill)
) ENGINE=InnoDB;

-- User Languages
CREATE TABLE IF NOT EXISTS user_languages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  language VARCHAR(50) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_language (user_id, language)
) ENGINE=InnoDB;

-- Refresh Tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(500) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_token (token(255))
) ENGINE=InnoDB;

-- Help Categories
CREATE TABLE IF NOT EXISTS help_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type ENUM('paid','volunteer','emergency') NOT NULL,
  icon VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE
) ENGINE=InnoDB;

-- Help Requests
CREATE TABLE IF NOT EXISTS help_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  type ENUM('paid','free','emergency') NOT NULL,
  budget DECIMAL(10,2),
  date DATE,
  start_time TIME,
  end_time TIME,
  hours_required DECIMAL(4,1),
  helpers_required INT DEFAULT 1,
  helpers_confirmed INT DEFAULT 0,
  status ENUM('open','in_progress','completed','cancelled','closed') DEFAULT 'open',
  payment_status ENUM('unpaid','paid') DEFAULT 'unpaid',
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  location_text TEXT,
  district VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(20),
  is_featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES help_categories(id),
  INDEX idx_status (status),
  INDEX idx_type (type),
  INDEX idx_category (category_id),
  INDEX idx_location (latitude, longitude),
  INDEX idx_user (user_id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- Help Request Images
CREATE TABLE IF NOT EXISTS help_request_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  help_request_id INT NOT NULL,
  image_url TEXT NOT NULL,
  FOREIGN KEY (help_request_id) REFERENCES help_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Help Request Applications
CREATE TABLE IF NOT EXISTS help_request_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  help_request_id INT NOT NULL,
  user_id INT NOT NULL,
  status ENUM('pending','accepted','rejected','completed','started_journey','arrived','work_started') DEFAULT 'pending',
  message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (help_request_id) REFERENCES help_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_application (help_request_id, user_id),
  INDEX idx_status (status)
) ENGINE=InnoDB;

-- Help Request Saves
CREATE TABLE IF NOT EXISTS help_request_saves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  help_request_id INT NOT NULL,
  user_id INT NOT NULL,
  FOREIGN KEY (help_request_id) REFERENCES help_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_save (help_request_id, user_id)
) ENGINE=InnoDB;

-- Events
CREATE TABLE IF NOT EXISTS events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  banner_url TEXT,
  description TEXT,
  date DATE NOT NULL,
  time TIME NOT NULL,
  venue VARCHAR(255),
  venue_latitude DECIMAL(10,8),
  venue_longitude DECIMAL(11,8),
  max_participants INT DEFAULT 0,
  current_participants INT DEFAULT 0,
  status ENUM('upcoming','ongoing','completed','cancelled') DEFAULT 'upcoming',
  category VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_status (status),
  INDEX idx_date (date)
) ENGINE=InnoDB;

-- Event Registrations
CREATE TABLE IF NOT EXISTS event_registrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_registration (event_id, user_id)
) ENGINE=InnoDB;

-- Community Groups
CREATE TABLE IF NOT EXISTS community_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  banner_url TEXT,
  category VARCHAR(100),
  is_public BOOLEAN DEFAULT TRUE,
  member_count INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_category (category)
) ENGINE=InnoDB;

-- Group Members
CREATE TABLE IF NOT EXISTS group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('admin','moderator','member') DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_membership (group_id, user_id)
) ENGINE=InnoDB;

-- Group Announcements
CREATE TABLE IF NOT EXISTS group_announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Messages (1-on-1)
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender_id INT NOT NULL,
  receiver_id INT NOT NULL,
  content TEXT,
  image_url TEXT,
  location_lat DECIMAL(10,8),
  location_lng DECIMAL(11,8),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_conversation (sender_id, receiver_id),
  INDEX idx_read (is_read)
) ENGINE=InnoDB;

-- Group Messages
CREATE TABLE IF NOT EXISTS group_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  sender_id INT NOT NULL,
  content TEXT,
  image_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_group (group_id)
) ENGINE=InnoDB;

-- Event Discussions (chat)
CREATE TABLE IF NOT EXISTS event_discussions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  content TEXT,
  image_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_event (event_id)
) ENGINE=InnoDB;

-- Wallets
CREATE TABLE IF NOT EXISTS wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNIQUE NOT NULL,
  balance DECIMAL(10,2) DEFAULT 0.00,
  total_earned DECIMAL(10,2) DEFAULT 0.00,
  cashback_earned DECIMAL(10,2) DEFAULT 0.00,
  reward_coins INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wallet_id INT NOT NULL,
  type ENUM('credit','debit') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  description VARCHAR(255),
  reference_type ENUM('task_payment','withdrawal','refund','bonus','reward'),
  reference_id INT,
  status ENUM('pending','completed','failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
  INDEX idx_wallet (wallet_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- Ratings
CREATE TABLE IF NOT EXISTS ratings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  help_request_id INT NOT NULL,
  from_user_id INT NOT NULL,
  to_user_id INT NOT NULL,
  rating TINYINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (help_request_id) REFERENCES help_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_rating (help_request_id, from_user_id, to_user_id),
  INDEX idx_to_user (to_user_id)
) ENGINE=InnoDB;

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  type ENUM('task','event','chat','payment','emergency','system') NOT NULL,
  reference_type VARCHAR(50),
  reference_id INT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_read (user_id, is_read),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- Admin Logs
CREATE TABLE IF NOT EXISTS admin_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  action VARCHAR(255) NOT NULL,
  target_type VARCHAR(50),
  target_id INT,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_admin (admin_id),
  INDEX idx_action (action)
) ENGINE=InnoDB;

-- Reports
CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT NOT NULL,
  reported_user_id INT,
  help_request_id INT,
  reason VARCHAR(255) NOT NULL,
  description TEXT,
  status ENUM('pending','resolved','dismissed') DEFAULT 'pending',
  resolved_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (help_request_id) REFERENCES help_requests(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_status (status)
) ENGINE=InnoDB;

-- Badges
CREATE TABLE IF NOT EXISTS badges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon_url TEXT,
  criteria JSON
) ENGINE=InnoDB;

-- User Badges
CREATE TABLE IF NOT EXISTS user_badges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  badge_id INT NOT NULL,
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (badge_id) REFERENCES badges(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_badge (user_id, badge_id)
) ENGINE=InnoDB;

-- Community Reviews (not tied to a help request)
CREATE TABLE IF NOT EXISTS community_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_user_id INT NOT NULL,
  to_user_id INT NOT NULL,
  rating TINYINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_to_user (to_user_id)
) ENGINE=InnoDB;
