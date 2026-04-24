<?php
/**
 * Plugin Name: GateTest — AI Code Quality Scanner
 * Plugin URI:  https://gatetest.ai
 * Description: Scan your WordPress theme, plugin, or custom code repository with 67 AI-powered quality modules. Catches security vulnerabilities, N+1 queries, accessibility issues, PII leaks, and more. Auto-fix PRs included.
 * Version:     1.0.0
 * Author:      GateTest
 * Author URI:  https://gatetest.ai
 * License:     GPL-2.0+
 * License URI: https://www.gnu.org/licenses/gpl-2.0.txt
 * Text Domain: gatetest
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'GATETEST_VERSION', '1.0.0' );
define( 'GATETEST_API_BASE', 'https://gatetest.ai/api/v1' );
define( 'GATETEST_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'GATETEST_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// ─── Activation / deactivation ─────────────────────────────────────────────

register_activation_hook( __FILE__, 'gatetest_activate' );
register_deactivation_hook( __FILE__, 'gatetest_deactivate' );

function gatetest_activate() {
    if ( ! wp_next_scheduled( 'gatetest_weekly_scan' ) ) {
        wp_schedule_event( time(), 'weekly', 'gatetest_weekly_scan' );
    }
}

function gatetest_deactivate() {
    wp_clear_scheduled_hook( 'gatetest_weekly_scan' );
}

// ─── Admin menu ─────────────────────────────────────────────────────────────

add_action( 'admin_menu', 'gatetest_admin_menu' );

function gatetest_admin_menu() {
    add_menu_page(
        __( 'GateTest Scanner', 'gatetest' ),
        __( 'GateTest', 'gatetest' ),
        'manage_options',
        'gatetest',
        'gatetest_scan_page',
        'data:image/svg+xml;base64,' . base64_encode( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg>' ),
        75
    );
    add_submenu_page(
        'gatetest',
        __( 'Run Scan', 'gatetest' ),
        __( 'Run Scan', 'gatetest' ),
        'manage_options',
        'gatetest',
        'gatetest_scan_page'
    );
    add_submenu_page(
        'gatetest',
        __( 'Settings', 'gatetest' ),
        __( 'Settings', 'gatetest' ),
        'manage_options',
        'gatetest-settings',
        'gatetest_settings_page'
    );
}

// ─── Settings page ──────────────────────────────────────────────────────────

add_action( 'admin_init', 'gatetest_register_settings' );

function gatetest_register_settings() {
    register_setting( 'gatetest_options', 'gatetest_api_key', array(
        'sanitize_callback' => 'sanitize_text_field',
        'default'           => '',
    ) );
    register_setting( 'gatetest_options', 'gatetest_repo_url', array(
        'sanitize_callback' => 'esc_url_raw',
        'default'           => '',
    ) );
    register_setting( 'gatetest_options', 'gatetest_default_tier', array(
        'sanitize_callback' => 'sanitize_text_field',
        'default'           => 'quick',
    ) );
    register_setting( 'gatetest_options', 'gatetest_auto_scan', array(
        'sanitize_callback' => 'absint',
        'default'           => 0,
    ) );
}

function gatetest_settings_page() {
    if ( ! current_user_can( 'manage_options' ) ) {
        return;
    }
    ?>
    <div class="wrap">
        <h1><?php esc_html_e( 'GateTest Settings', 'gatetest' ); ?></h1>
        <form method="post" action="options.php">
            <?php
            settings_fields( 'gatetest_options' );
            $api_key  = get_option( 'gatetest_api_key', '' );
            $repo_url = get_option( 'gatetest_repo_url', '' );
            $tier     = get_option( 'gatetest_default_tier', 'quick' );
            $auto     = get_option( 'gatetest_auto_scan', 0 );
            ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row">
                        <label for="gatetest_api_key"><?php esc_html_e( 'GateTest API Key', 'gatetest' ); ?></label>
                    </th>
                    <td>
                        <input
                            type="password"
                            id="gatetest_api_key"
                            name="gatetest_api_key"
                            value="<?php echo esc_attr( $api_key ); ?>"
                            class="regular-text"
                            autocomplete="off"
                        />
                        <p class="description">
                            <?php
                            printf(
                                wp_kses(
                                    /* translators: %s: link to API keys page */
                                    __( 'Get your API key from <a href="%s" target="_blank" rel="noopener noreferrer">gatetest.ai/admin → API Keys</a>.', 'gatetest' ),
                                    array( 'a' => array( 'href' => array(), 'target' => array(), 'rel' => array() ) )
                                ),
                                'https://gatetest.ai/admin'
                            );
                            ?>
                        </p>
                    </td>
                </tr>
                <tr>
                    <th scope="row">
                        <label for="gatetest_repo_url"><?php esc_html_e( 'GitHub Repository URL', 'gatetest' ); ?></label>
                    </th>
                    <td>
                        <input
                            type="url"
                            id="gatetest_repo_url"
                            name="gatetest_repo_url"
                            value="<?php echo esc_attr( $repo_url ); ?>"
                            class="regular-text"
                            placeholder="https://github.com/your-org/your-repo"
                        />
                        <p class="description"><?php esc_html_e( 'The GitHub repository URL for your theme or plugin.', 'gatetest' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th scope="row">
                        <label for="gatetest_default_tier"><?php esc_html_e( 'Default Scan Tier', 'gatetest' ); ?></label>
                    </th>
                    <td>
                        <select id="gatetest_default_tier" name="gatetest_default_tier">
                            <option value="quick" <?php selected( $tier, 'quick' ); ?>><?php esc_html_e( 'Quick — 39 modules ($29)', 'gatetest' ); ?></option>
                            <option value="full"  <?php selected( $tier, 'full' ); ?>><?php esc_html_e( 'Full — 67 modules ($99)', 'gatetest' ); ?></option>
                        </select>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><?php esc_html_e( 'Weekly Auto-Scan', 'gatetest' ); ?></th>
                    <td>
                        <label for="gatetest_auto_scan">
                            <input
                                type="checkbox"
                                id="gatetest_auto_scan"
                                name="gatetest_auto_scan"
                                value="1"
                                <?php checked( $auto, 1 ); ?>
                            />
                            <?php esc_html_e( 'Automatically scan your repository once a week', 'gatetest' ); ?>
                        </label>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

// ─── Scan page ───────────────────────────────────────────────────────────────

function gatetest_scan_page() {
    if ( ! current_user_can( 'manage_options' ) ) {
        return;
    }

    $api_key      = get_option( 'gatetest_api_key', '' );
    $saved_repo   = get_option( 'gatetest_repo_url', '' );
    $default_tier = get_option( 'gatetest_default_tier', 'quick' );
    $last_result  = get_option( 'gatetest_last_result', null );
    $last_scanned = get_option( 'gatetest_last_scanned', '' );

    if ( ! $api_key ) {
        echo '<div class="wrap"><div class="notice notice-warning"><p>';
        printf(
            wp_kses(
                __( 'GateTest API key not set. <a href="%s">Configure it in Settings</a>.', 'gatetest' ),
                array( 'a' => array( 'href' => array() ) )
            ),
            esc_url( admin_url( 'admin.php?page=gatetest-settings' ) )
        );
        echo '</p></div></div>';
        return;
    }
    ?>
    <div class="wrap">
        <h1><?php esc_html_e( 'GateTest — Run Scan', 'gatetest' ); ?></h1>

        <div class="card" style="max-width:600px;padding:20px;margin-bottom:20px;">
            <h2 style="margin-top:0;"><?php esc_html_e( 'Scan a Repository', 'gatetest' ); ?></h2>
            <table class="form-table" role="presentation">
                <tr>
                    <th><label for="gt-repo"><?php esc_html_e( 'Repository URL', 'gatetest' ); ?></label></th>
                    <td>
                        <input
                            type="url"
                            id="gt-repo"
                            class="regular-text"
                            value="<?php echo esc_attr( $saved_repo ); ?>"
                            placeholder="https://github.com/owner/repo"
                        />
                    </td>
                </tr>
                <tr>
                    <th><label for="gt-tier"><?php esc_html_e( 'Scan Tier', 'gatetest' ); ?></label></th>
                    <td>
                        <select id="gt-tier">
                            <option value="quick" <?php selected( $default_tier, 'quick' ); ?>><?php esc_html_e( 'Quick — 39 modules ($29)', 'gatetest' ); ?></option>
                            <option value="full"  <?php selected( $default_tier, 'full' ); ?>><?php esc_html_e( 'Full — 67 modules ($99)', 'gatetest' ); ?></option>
                        </select>
                    </td>
                </tr>
            </table>
            <button id="gt-run-scan" class="button button-primary" style="margin-top:10px;">
                <?php esc_html_e( 'Run Scan', 'gatetest' ); ?>
            </button>
            <span id="gt-scan-status" style="margin-left:12px;display:none;color:#2271b1;">
                <?php esc_html_e( 'Scanning… this may take up to 60 seconds.', 'gatetest' ); ?>
            </span>
            <div id="gt-scan-error" style="display:none;margin-top:10px;" class="notice notice-error"><p></p></div>
        </div>

        <?php if ( $last_result ) : ?>
        <div id="gt-results">
            <?php gatetest_render_results( $last_result, $last_scanned ); ?>
        </div>
        <?php endif; ?>
    </div>

    <script>
    (function($) {
        $('#gt-run-scan').on('click', function() {
            var repo = $('#gt-repo').val().trim();
            var tier = $('#gt-tier').val();
            if (!repo) {
                alert('<?php echo esc_js( __( 'Please enter a repository URL.', 'gatetest' ) ); ?>');
                return;
            }
            $('#gt-run-scan').prop('disabled', true);
            $('#gt-scan-status').show();
            $('#gt-scan-error').hide();

            $.post(ajaxurl, {
                action: 'gatetest_run_scan',
                nonce:  '<?php echo esc_js( wp_create_nonce( 'gatetest_scan' ) ); ?>',
                repo:   repo,
                tier:   tier
            }, function(response) {
                $('#gt-run-scan').prop('disabled', false);
                $('#gt-scan-status').hide();
                if (response.success) {
                    $('#gt-results').html(response.data.html);
                } else {
                    $('#gt-scan-error p').text(response.data.message || '<?php echo esc_js( __( 'Scan failed. Check your API key and repository URL.', 'gatetest' ) ); ?>');
                    $('#gt-scan-error').show();
                }
            }).fail(function() {
                $('#gt-run-scan').prop('disabled', false);
                $('#gt-scan-status').hide();
                $('#gt-scan-error p').text('<?php echo esc_js( __( 'Network error. Please try again.', 'gatetest' ) ); ?>');
                $('#gt-scan-error').show();
            });
        });
    })(jQuery);
    </script>
    <?php
}

// ─── AJAX: run scan ──────────────────────────────────────────────────────────

add_action( 'wp_ajax_gatetest_run_scan', 'gatetest_ajax_run_scan' );

function gatetest_ajax_run_scan() {
    check_ajax_referer( 'gatetest_scan', 'nonce' );

    if ( ! current_user_can( 'manage_options' ) ) {
        wp_send_json_error( array( 'message' => __( 'Insufficient permissions.', 'gatetest' ) ) );
    }

    $repo = isset( $_POST['repo'] ) ? esc_url_raw( wp_unslash( $_POST['repo'] ) ) : '';
    $tier = isset( $_POST['tier'] ) && in_array( $_POST['tier'], array( 'quick', 'full' ), true )
        ? sanitize_text_field( wp_unslash( $_POST['tier'] ) )
        : 'quick';

    if ( ! $repo || ! filter_var( $repo, FILTER_VALIDATE_URL ) ) {
        wp_send_json_error( array( 'message' => __( 'Invalid repository URL.', 'gatetest' ) ) );
    }

    $api_key = get_option( 'gatetest_api_key', '' );
    if ( ! $api_key ) {
        wp_send_json_error( array( 'message' => __( 'API key not configured.', 'gatetest' ) ) );
    }

    $response = wp_remote_post(
        GATETEST_API_BASE . '/scan',
        array(
            'timeout' => 120,
            'headers' => array(
                'Authorization' => 'Bearer ' . $api_key,
                'Content-Type'  => 'application/json',
            ),
            'body' => wp_json_encode( array(
                'repoUrl' => $repo,
                'tier'    => $tier,
            ) ),
        )
    );

    if ( is_wp_error( $response ) ) {
        wp_send_json_error( array( 'message' => $response->get_error_message() ) );
    }

    $code = wp_remote_retrieve_response_code( $response );
    $body = json_decode( wp_remote_retrieve_body( $response ), true );

    if ( $code !== 200 || empty( $body ) ) {
        $msg = isset( $body['error'] ) ? $body['error'] : __( 'Scan failed. Check your API key.', 'gatetest' );
        wp_send_json_error( array( 'message' => $msg ) );
    }

    $now = current_time( 'mysql' );
    update_option( 'gatetest_last_result', $body );
    update_option( 'gatetest_last_scanned', $now );
    update_option( 'gatetest_last_repo', $repo );

    ob_start();
    gatetest_render_results( $body, $now );
    $html = ob_get_clean();

    wp_send_json_success( array( 'html' => $html ) );
}

// ─── Results renderer ────────────────────────────────────────────────────────

function gatetest_render_results( $result, $scanned_at ) {
    if ( ! is_array( $result ) ) {
        return;
    }

    $passed       = isset( $result['passed'] ) ? (bool) $result['passed'] : false;
    $total_issues = isset( $result['totalIssues'] ) ? (int) $result['totalIssues'] : 0;
    $modules      = isset( $result['modules'] ) && is_array( $result['modules'] ) ? $result['modules'] : array();
    $duration     = isset( $result['duration'] ) ? (int) $result['duration'] : 0;
    $repo_url     = get_option( 'gatetest_last_repo', '' );

    $status_color = $passed ? '#00a32a' : '#d63638';
    $status_label = $passed ? __( 'GATE PASSED', 'gatetest' ) : sprintf( __( '%d ISSUES FOUND', 'gatetest' ), $total_issues );
    ?>
    <div class="card" style="max-width:800px;padding:20px;margin-bottom:16px;border-left:4px solid <?php echo esc_attr( $status_color ); ?>;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div>
                <h2 style="margin:0 0 4px;color:<?php echo esc_attr( $status_color ); ?>;">
                    <?php echo esc_html( $status_label ); ?>
                </h2>
                <p style="margin:0;color:#646970;font-size:13px;">
                    <?php
                    printf(
                        /* translators: 1: module count, 2: duration ms, 3: date */
                        esc_html__( '%1$d modules · %2$dms · %3$s', 'gatetest' ),
                        count( $modules ),
                        $duration,
                        esc_html( $scanned_at )
                    );
                    ?>
                </p>
            </div>
            <?php if ( $repo_url ) : ?>
            <a
                href="<?php echo esc_url( 'https://gatetest.ai/scan/status?repo=' . rawurlencode( $repo_url ) ); ?>"
                target="_blank"
                rel="noopener noreferrer"
                class="button"
            >
                <?php esc_html_e( 'View Full Report →', 'gatetest' ); ?>
            </a>
            <?php endif; ?>
        </div>
    </div>

    <?php if ( ! empty( $modules ) ) : ?>
    <div class="card" style="max-width:800px;padding:0;overflow:hidden;margin-bottom:16px;">
        <table class="widefat striped" style="border:none;">
            <thead>
                <tr>
                    <th><?php esc_html_e( 'Module', 'gatetest' ); ?></th>
                    <th><?php esc_html_e( 'Status', 'gatetest' ); ?></th>
                    <th><?php esc_html_e( 'Issues', 'gatetest' ); ?></th>
                    <th><?php esc_html_e( 'Checks', 'gatetest' ); ?></th>
                    <th><?php esc_html_e( 'Time', 'gatetest' ); ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ( $modules as $mod ) :
                    $mod_status  = isset( $mod['status'] ) ? $mod['status'] : 'unknown';
                    $mod_name    = isset( $mod['name'] ) ? $mod['name'] : '';
                    $mod_issues  = isset( $mod['issues'] ) ? (int) $mod['issues'] : 0;
                    $mod_checks  = isset( $mod['checks'] ) ? (int) $mod['checks'] : 0;
                    $mod_dur     = isset( $mod['duration'] ) ? (int) $mod['duration'] : 0;
                    $mod_details = isset( $mod['details'] ) && is_array( $mod['details'] ) ? $mod['details'] : array();
                    $row_color   = $mod_status === 'failed' ? '#fcf0f1' : ( $mod_status === 'passed' ? '#f0fdf4' : '' );
                    $badge_color = $mod_status === 'failed' ? '#d63638' : ( $mod_status === 'passed' ? '#00a32a' : '#646970' );
                    $badge_label = $mod_status === 'failed' ? __( 'FAIL', 'gatetest' ) : ( $mod_status === 'passed' ? __( 'PASS', 'gatetest' ) : __( 'SKIP', 'gatetest' ) );
                ?>
                <tr style="background:<?php echo esc_attr( $row_color ); ?>">
                    <td><strong><?php echo esc_html( $mod_name ); ?></strong>
                        <?php if ( $mod_details ) : ?>
                        <details style="margin-top:4px;">
                            <summary style="cursor:pointer;font-size:12px;color:#646970;"><?php printf( esc_html__( '%d detail(s)', 'gatetest' ), count( $mod_details ) ); ?></summary>
                            <ul style="margin:6px 0 0 16px;font-size:12px;color:#646970;">
                                <?php foreach ( array_slice( $mod_details, 0, 10 ) as $detail ) : ?>
                                <li><?php echo esc_html( $detail ); ?></li>
                                <?php endforeach; ?>
                                <?php if ( count( $mod_details ) > 10 ) : ?>
                                <li><?php printf( esc_html__( '…and %d more', 'gatetest' ), count( $mod_details ) - 10 ); ?></li>
                                <?php endif; ?>
                            </ul>
                        </details>
                        <?php endif; ?>
                    </td>
                    <td>
                        <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#fff;background:<?php echo esc_attr( $badge_color ); ?>;">
                            <?php echo esc_html( $badge_label ); ?>
                        </span>
                    </td>
                    <td><?php echo esc_html( $mod_issues ); ?></td>
                    <td><?php echo esc_html( $mod_checks ); ?></td>
                    <td><?php echo esc_html( $mod_dur ); ?>ms</td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <?php endif; ?>
    <?php
}

// ─── Dashboard widget ────────────────────────────────────────────────────────

add_action( 'wp_dashboard_setup', 'gatetest_register_dashboard_widget' );

function gatetest_register_dashboard_widget() {
    wp_add_dashboard_widget(
        'gatetest_widget',
        __( 'GateTest — Code Quality Score', 'gatetest' ),
        'gatetest_dashboard_widget'
    );
}

function gatetest_dashboard_widget() {
    $last_result  = get_option( 'gatetest_last_result', null );
    $last_scanned = get_option( 'gatetest_last_scanned', '' );
    $api_key      = get_option( 'gatetest_api_key', '' );

    if ( ! $api_key ) {
        printf(
            wp_kses(
                __( '<p><a href="%s">Configure your API key</a> to start scanning.</p>', 'gatetest' ),
                array( 'p' => array(), 'a' => array( 'href' => array() ) )
            ),
            esc_url( admin_url( 'admin.php?page=gatetest-settings' ) )
        );
        return;
    }

    if ( $last_result && is_array( $last_result ) ) {
        $passed       = isset( $last_result['passed'] ) ? (bool) $last_result['passed'] : false;
        $total_issues = isset( $last_result['totalIssues'] ) ? (int) $last_result['totalIssues'] : 0;
        $modules      = isset( $last_result['modules'] ) && is_array( $last_result['modules'] ) ? $last_result['modules'] : array();
        $passed_mods  = count( array_filter( $modules, fn( $m ) => isset( $m['status'] ) && $m['status'] === 'passed' ) );
        $failed_mods  = count( array_filter( $modules, fn( $m ) => isset( $m['status'] ) && $m['status'] === 'failed' ) );

        $color = $passed ? '#00a32a' : '#d63638';
        ?>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;">
            <div style="width:56px;height:56px;border-radius:50%;background:<?php echo esc_attr( $color ); ?>;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <span style="color:#fff;font-size:20px;font-weight:700;"><?php echo $passed ? '✓' : '✗'; ?></span>
            </div>
            <div>
                <div style="font-size:18px;font-weight:700;color:<?php echo esc_attr( $color ); ?>;">
                    <?php echo $passed ? esc_html__( 'Gate Passed', 'gatetest' ) : sprintf( esc_html__( '%d Issues', 'gatetest' ), $total_issues ); ?>
                </div>
                <div style="font-size:12px;color:#646970;">
                    <?php printf( esc_html__( '%1$d passed · %2$d failed · %3$s', 'gatetest' ), $passed_mods, $failed_mods, esc_html( $last_scanned ) ); ?>
                </div>
            </div>
        </div>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=gatetest' ) ); ?>" class="button button-primary button-small">
            <?php esc_html_e( 'Run New Scan', 'gatetest' ); ?>
        </a>
        <?php
    } else {
        ?>
        <p><?php esc_html_e( 'No scans run yet.', 'gatetest' ); ?></p>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=gatetest' ) ); ?>" class="button button-primary button-small">
            <?php esc_html_e( 'Run First Scan', 'gatetest' ); ?>
        </a>
        <?php
    }
}

// ─── WP-Cron: auto-scan ──────────────────────────────────────────────────────

add_action( 'gatetest_weekly_scan', 'gatetest_run_auto_scan' );

function gatetest_run_auto_scan() {
    if ( ! get_option( 'gatetest_auto_scan', 0 ) ) {
        return;
    }

    $api_key  = get_option( 'gatetest_api_key', '' );
    $repo_url = get_option( 'gatetest_repo_url', '' );
    $tier     = get_option( 'gatetest_default_tier', 'quick' );

    if ( ! $api_key || ! $repo_url ) {
        return;
    }

    $response = wp_remote_post(
        GATETEST_API_BASE . '/scan',
        array(
            'timeout' => 120,
            'headers' => array(
                'Authorization' => 'Bearer ' . $api_key,
                'Content-Type'  => 'application/json',
            ),
            'body' => wp_json_encode( array(
                'repoUrl' => $repo_url,
                'tier'    => $tier,
            ) ),
        )
    );

    if ( ! is_wp_error( $response ) && wp_remote_retrieve_response_code( $response ) === 200 ) {
        $body = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( $body ) {
            update_option( 'gatetest_last_result', $body );
            update_option( 'gatetest_last_scanned', current_time( 'mysql' ) );
        }
    }
}
