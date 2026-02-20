package com.aethercore.atak.trustoverlay.core

import android.content.Context
import android.os.Bundle
import com.aethercore.atak.trustoverlay.atak.CotBus
import com.aethercore.atak.trustoverlay.atak.CotEventEnvelope
import com.aethercore.atak.trustoverlay.atak.Logger
import com.aethercore.atak.trustoverlay.atak.Subscription
import com.atakmap.comms.CotServiceRemote
import com.atakmap.coremap.cot.event.CotEvent
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class AtakCotBus(
    private val context: Context,
    private val logger: Logger,
    private val onFeedDegraded: (String) -> Unit,
) : CotBus {
    private val subscriptions = CopyOnWriteArrayList<SubscriptionState>()
    private val bound = AtomicBoolean(false)
    private val stopped = AtomicBoolean(false)
    private val cotRemote = CotServiceRemote()
    private val retryExecutor = Executors.newSingleThreadScheduledExecutor()
    @Volatile
    private var pendingRetry: ScheduledFuture<*>? = null

    init {
        bindWithBackoff()
    }

    override fun subscribe(cotType: String, handler: (CotEventEnvelope) -> Unit): Subscription {
        val state = SubscriptionState(cotType, handler)
        subscriptions.add(state)
        return object : Subscription {
            override fun dispose() {
                subscriptions.remove(state)
            }
        }
    }

    fun isBound(): Boolean = bound.get()

    fun stop() {
        stopped.set(true)
        pendingRetry?.cancel(false)
        retryExecutor.shutdownNow()
        runCatching {
            cotRemote.setCotEventListener(null)
            bound.set(false)
            logger.d("ATAK CoT listener unbound")
        }.onFailure { throwable ->
            onFeedDegraded("Failed to unbind CoT listener: ${throwable.message}")
        }
        subscriptions.clear()
    }

    private fun bindWithBackoff(maxAttempts: Int = 4, initialDelayMs: Long = 250L) {
        scheduleBindAttempt(attempt = 1, maxAttempts = maxAttempts, initialDelayMs = initialDelayMs, delayMs = 0L)
    }

    private fun scheduleBindAttempt(
        attempt: Int,
        maxAttempts: Int,
        initialDelayMs: Long,
        delayMs: Long,
    ) {
        if (stopped.get() || bound.get()) {
            return
        }

        pendingRetry = retryExecutor.schedule({
            if (stopped.get() || bound.get()) {
                return@schedule
            }

            val boundOnAttempt = bindOnce(attempt)
            if (boundOnAttempt || stopped.get()) {
                return@schedule
            }

            if (attempt >= maxAttempts) {
                if (!bound.get() && !stopped.get()) {
                    onFeedDegraded("CoT listener unavailable after retries")
                }
                return@schedule
            }

            val nextDelayMs = initialDelayMs * (1L shl (attempt - 1))
            scheduleBindAttempt(
                attempt = attempt + 1,
                maxAttempts = maxAttempts,
                initialDelayMs = initialDelayMs,
                delayMs = nextDelayMs,
            )
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun bindOnce(attempt: Int): Boolean {
        return runCatching {
            cotRemote.setCotEventListener(object : CotServiceRemote.CotEventListener {
                override fun onCotEvent(event: CotEvent, extra: Bundle) {
                    val envelope = event.toEnvelope()
                    dispatch(envelope)
                }
            })
            bound.set(true)
            logger.d("ATAK CoT listener bound on attempt $attempt")
            true
        }.onFailure { throwable ->
            bound.set(false)
            onFeedDegraded("CoT bind attempt $attempt failed: ${throwable.message}")
        }.getOrDefault(false)
    }

    private fun dispatch(envelope: CotEventEnvelope) {
        subscriptions.forEach { sub ->
            if (sub.cotType == envelope.type) {
                sub.handler(envelope)
            }
        }
    }

    private data class SubscriptionState(
        val cotType: String,
        val handler: (CotEventEnvelope) -> Unit,
    )

    private fun CotEvent.toEnvelope(): CotEventEnvelope {
        val detailMap = linkedMapOf<String, String>()
        runCatching { detail }.getOrNull()?.let { detailXml ->
            detailMap["detail"] = detailXml
        }
        runCatching { how }.getOrNull()?.takeIf { it.isNotBlank() }?.let { detailMap["source"] = it }
        runCatching { time.toString() }.getOrNull()?.let { detailMap["time"] = it }
        runCatching { stale.toString() }.getOrNull()?.let { detailMap["stale"] = it }

        return CotEventEnvelope(
            uid = runCatching { uid }.getOrDefault(""),
            type = runCatching { type }.getOrDefault(""),
            lat = runCatching { geoPoint?.latitude }.getOrNull(),
            lon = runCatching { geoPoint?.longitude }.getOrNull(),
            time = runCatching { time.toString() }.getOrNull(),
            stale = runCatching { stale.toString() }.getOrNull(),
            detail = detailMap,
        )
    }
}
