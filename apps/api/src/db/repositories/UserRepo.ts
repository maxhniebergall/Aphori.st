import { query, withTransaction } from '../pool.js';
import type { User, UserType, UserResult } from '@chitin/shared';

interface UserRow {
  id: string;
  email: string;
  user_type: UserType;
  display_name: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    user_type: row.user_type,
    display_name: row.display_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

export const UserRepo = {
  async findById(id: string): Promise<User | null> {
    const result = await query<UserRow>(
      'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
      [id.toLowerCase()]
    );
    return result.rows[0] ? rowToUser(result.rows[0]) : null;
  },

  async findByEmail(email: string): Promise<User | null> {
    const result = await query<UserRow>(
      'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );
    return result.rows[0] ? rowToUser(result.rows[0]) : null;
  },

  async create(
    id: string,
    email: string,
    userType: UserType = 'human',
    displayName?: string
  ): Promise<UserResult> {
    const lowerId = id.toLowerCase();
    const lowerEmail = email.toLowerCase();

    try {
      // Check if ID is taken
      const existingById = await this.findById(lowerId);
      if (existingById) {
        return { success: false, error: 'User ID already taken' };
      }

      // Check if email is taken
      const existingByEmail = await this.findByEmail(lowerEmail);
      if (existingByEmail) {
        return { success: false, error: 'Email already registered' };
      }

      const result = await query<UserRow>(
        `INSERT INTO users (id, email, user_type, display_name)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [lowerId, lowerEmail, userType, displayName ?? null]
      );

      return {
        success: true,
        data: rowToUser(result.rows[0]!),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create user',
      };
    }
  },

  async updateDisplayName(id: string, displayName: string): Promise<User | null> {
    const result = await query<UserRow>(
      `UPDATE users SET display_name = $2
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [id.toLowerCase(), displayName]
    );
    return result.rows[0] ? rowToUser(result.rows[0]) : null;
  },

  async softDelete(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [id.toLowerCase()]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async isIdAvailable(id: string): Promise<boolean> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM users WHERE id = $1',
      [id.toLowerCase()]
    );
    return result.rows[0]?.count === '0';
  },
};
