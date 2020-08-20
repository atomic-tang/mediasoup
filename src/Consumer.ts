import { Logger } from './Logger';
import { EnhancedEventEmitter } from './EnhancedEventEmitter';
import { Channel } from './Channel';
import { PayloadChannel } from './PayloadChannel';
import { ProducerStat } from './Producer';
import {
	MediaKind,
	RtpCapabilities,
	RtpParameters
} from './RtpParameters';

export type ConsumerOptions =
{
	/**
	 * The id of the Producer to consume.
	 */
	producerId: string;

	/**
	 * RTP capabilities of the consuming endpoint.
	 */
	rtpCapabilities?: RtpCapabilities;

	/**
	 * Whether the Consumer must start in paused mode. Default false.
	 *
	 * When creating a video Consumer, it's recommended to set paused to true,
	 * then transmit the Consumer parameters to the consuming endpoint and, once
	 * the consuming endpoint has created its local side Consumer, unpause the
	 * server side Consumer using the resume() method. This is an optimization
	 * to make it possible for the consuming endpoint to render the video as far
	 * as possible. If the server side Consumer was created with paused: false,
	 * mediasoup will immediately request a key frame to the remote Producer and
	 * suych a key frame may reach the consuming endpoint even before it's ready
	 * to consume it, generating “black” video until the device requests a keyframe
	 * by itself.
	 */
	paused?: boolean;

	/**
	 * Preferred spatial and temporal layer for simulcast or SVC media sources.
	 * If unset, the highest ones are selected.
	 */
	preferredLayers?: ConsumerLayers;

	/**
	 * Custom application data.
	 */
	appData?: any;
}

/**
 * Valid types for 'trace' event.
 */
export type ConsumerTraceEventType = 'rtp' | 'keyframe' | 'nack' | 'pli' | 'fir';

/**
 * 'trace' event data.
 */
export type ConsumerTraceEventData =
{
	/**
	 * Trace type.
	 */
	type: ConsumerTraceEventType;

	/**
	 * Event timestamp.
	 */
	timestamp: number;

	/**
	 * Event direction.
	 */
	direction: 'in' | 'out';

	/**
	 * Per type information.
	 */
	info: any;
}

export type ConsumerScore =
{
	/**
	 * The score of the RTP stream of the consumer.
	 */
	score: number;

	/**
	 * The score of the currently selected RTP stream of the producer.
	 */
	producerScore: number;

	/**
	 * The scores of all RTP streams in the producer ordered by encoding (just
	 * useful when the producer uses simulcast).
	 */
	producerScores: number[];
}

export type ConsumerLayers =
{
	/**
	 * The spatial layer index (from 0 to N).
	 */
	spatialLayer: number;

	/**
	 * The temporal layer index (from 0 to N).
	 */
	temporalLayer?: number;
}

export type ConsumerStat =
{
	// Common to all RtpStreams.
	type: string;
	timestamp: number;
	ssrc: number;
	rtxSsrc?: number;
	kind: string;
	mimeType: string;
	packetsLost: number;
	fractionLost: number;
	packetsDiscarded: number;
	packetsRetransmitted: number;
	packetsRepaired: number;
	nackCount: number;
	nackPacketCount: number;
	pliCount: number;
	firCount: number;
	score: number;
	packetCount: number;
	byteCount: number;
	bitrate: number;
	roundTripTime?: number;
}

/**
 * Consumer type.
 */
export type ConsumerType = 'simple' | 'simulcast' | 'svc' | 'pipe';

const logger = new Logger('Consumer');

export class Consumer extends EnhancedEventEmitter
{
	// Internal data.
	private readonly _internal:
	{
		routerId: string;
		transportId: string;
		consumerId: string;
		producerId: string;
	};

	// Consumer data.
	private readonly _data:
	{
		kind: MediaKind;
		rtpParameters: RtpParameters;
		type: ConsumerType;
	};

	// Channel instance.
	private readonly _channel: Channel;

	// PayloadChannel instance.
	private readonly _payloadChannel: PayloadChannel;

	// Closed flag.
	private _closed = false;

	// Custom app data.
	private readonly _appData?: any;

	// Paused flag.
	private _paused = false;

	// Associated Producer paused flag.
	private _producerPaused = false;

	// Current priority.
	private _priority = 1;

	// Current score.
	private _score: ConsumerScore;

	// Preferred layers.
	private _preferredLayers?: ConsumerLayers;

	// Curent layers.
	private _currentLayers?: ConsumerLayers;

	// Observer instance.
	private readonly _observer = new EnhancedEventEmitter();

	/**
	 * @private
	 * @emits transportclose
	 * @emits producerclose
	 * @emits producerpause
	 * @emits producerresume
	 * @emits score - (score: ConsumerScore)
	 * @emits layerschange - (layers: ConsumerLayers | undefined)
	 * @emits rtp - (packet: Buffer)
	 * @emits trace - (trace: ConsumerTraceEventData)
	 * @emits @close
	 * @emits @producerclose
	 */
	constructor(
		{
			internal,
			data,
			channel,
			payloadChannel,
			appData,
			paused,
			producerPaused,
			score = { score: 10, producerScore: 10, producerScores: [] },
			preferredLayers
		}:
		{
			internal: any;
			data: any;
			channel: Channel;
			payloadChannel: PayloadChannel;
			appData?: any;
			paused: boolean;
			producerPaused: boolean;
			score?: ConsumerScore;
			preferredLayers?: ConsumerLayers;
		})
	{
		super();

		logger.debug('constructor()');

		this._internal = internal;
		this._data = data;
		this._channel = channel;
		this._payloadChannel = payloadChannel;
		this._appData = appData;
		this._paused = paused;
		this._producerPaused = producerPaused;
		this._score = score;
		this._preferredLayers = preferredLayers;

		this._handleWorkerNotifications();
	}

	/**
	 * Consumer id.
	 */
	get id(): string
	{
		return this._internal.consumerId;
	}

	/**
	 * Associated Producer id.
	 */
	get producerId(): string
	{
		return this._internal.producerId;
	}

	/**
	 * Whether the Consumer is closed.
	 */
	get closed(): boolean
	{
		return this._closed;
	}

	/**
	 * Media kind.
	 */
	get kind(): MediaKind
	{
		return this._data.kind;
	}

	/**
	 * RTP parameters.
	 */
	get rtpParameters(): RtpParameters
	{
		return this._data.rtpParameters;
	}

	/**
	 * Consumer type.
	 */
	get type(): ConsumerType
	{
		return this._data.type;
	}

	/**
	 * Whether the Consumer is paused.
	 */
	get paused(): boolean
	{
		return this._paused;
	}

	/**
	 * Whether the associate Producer is paused.
	 */
	get producerPaused(): boolean
	{
		return this._producerPaused;
	}

	/**
	 * Current priority.
	 */
	get priority(): number
	{
		return this._priority;
	}

	/**
	 * Consumer score.
	 */
	get score(): ConsumerScore
	{
		return this._score;
	}

	/**
	 * Preferred video layers.
	 */
	get preferredLayers(): ConsumerLayers | undefined
	{
		return this._preferredLayers;
	}

	/**
	 * Current video layers.
	 */
	get currentLayers(): ConsumerLayers | undefined
	{
		return this._currentLayers;
	}

	/**
	 * App custom data.
	 */
	get appData(): any
	{
		return this._appData;
	}

	/**
	 * Invalid setter.
	 */
	set appData(appData) // eslint-disable-line no-unused-vars
	{
		throw new Error('cannot override appData object');
	}

	/**
	 * Observer.
	 *
	 * @emits close
	 * @emits pause
	 * @emits resume
	 * @emits score - (score: ConsumerScore)
	 * @emits layerschange - (layers: ConsumerLayers | undefined)
	 * @emits trace - (trace: ConsumerTraceEventData)
	 */
	get observer(): EnhancedEventEmitter
	{
		return this._observer;
	}

	/**
	 * Close the Consumer.
	 */
	close(): void
	{
		if (this._closed)
			return;

		logger.debug('close()');

		this._closed = true;

		// Remove notification subscriptions.
		this._channel.removeAllListeners(this._internal.consumerId);

		this._channel.request('consumer.close', this._internal)
			.catch(() => {});

		this.emit('@close');

		// Emit observer event.
		this._observer.safeEmit('close');
	}

	/**
	 * Transport was closed.
	 *
	 * @private
	 */
	transportClosed(): void
	{
		if (this._closed)
			return;

		logger.debug('transportClosed()');

		this._closed = true;

		// Remove notification subscriptions.
		this._channel.removeAllListeners(this._internal.consumerId);

		this.safeEmit('transportclose');

		// Emit observer event.
		this._observer.safeEmit('close');
	}

	/**
	 * Dump Consumer.
	 */
	async dump(): Promise<any>
	{
		logger.debug('dump()');

		return this._channel.request('consumer.dump', this._internal);
	}

	/**
	 * Get Consumer stats.
	 */
	async getStats(): Promise<Array<ConsumerStat | ProducerStat>>
	{
		logger.debug('getStats()');

		return this._channel.request('consumer.getStats', this._internal);
	}

	/**
	 * Pause the Consumer.
	 */
	async pause(): Promise<void>
	{
		logger.debug('pause()');

		const wasPaused = this._paused || this._producerPaused;

		await this._channel.request('consumer.pause', this._internal);

		this._paused = true;

		// Emit observer event.
		if (!wasPaused)
			this._observer.safeEmit('pause');
	}

	/**
	 * Resume the Consumer.
	 */
	async resume(): Promise<void>
	{
		logger.debug('resume()');

		const wasPaused = this._paused || this._producerPaused;

		await this._channel.request('consumer.resume', this._internal);

		this._paused = false;

		// Emit observer event.
		if (wasPaused && !this._producerPaused)
			this._observer.safeEmit('resume');
	}

	/**
	 * Set preferred video layers.
	 */
	async setPreferredLayers(
		{
			spatialLayer,
			temporalLayer
		}: ConsumerLayers
	): Promise<void>
	{
		logger.debug('setPreferredLayers()');

		const reqData = { spatialLayer, temporalLayer };

		const data = await this._channel.request(
			'consumer.setPreferredLayers', this._internal, reqData);

		this._preferredLayers = data || undefined;
	}

	/**
	 * Set priority.
	 */
	async setPriority(priority: number): Promise<void>
	{
		logger.debug('setPriority()');

		const reqData = { priority };

		const data = await this._channel.request(
			'consumer.setPriority', this._internal, reqData);

		this._priority = data.priority;
	}

	/**
	 * Unset priority.
	 */
	async unsetPriority(): Promise<void>
	{
		logger.debug('unsetPriority()');

		const reqData = { priority: 1 };

		const data = await this._channel.request(
			'consumer.setPriority', this._internal, reqData);

		this._priority = data.priority;
	}

	/**
	 * Request a key frame to the Producer.
	 */
	async requestKeyFrame(): Promise<void>
	{
		logger.debug('requestKeyFrame()');

		await this._channel.request('consumer.requestKeyFrame', this._internal);
	}

	/**
	 * Enable 'trace' event.
	 */
	async enableTraceEvent(types: ConsumerTraceEventType[] = []): Promise<void>
	{
		logger.debug('enableTraceEvent()');

		const reqData = { types };

		await this._channel.request(
			'consumer.enableTraceEvent', this._internal, reqData);
	}

	private _handleWorkerNotifications(): void
	{
		this._channel.on(this._internal.consumerId, (event: string, data?: any) =>
		{
			switch (event)
			{
				case 'producerclose':
				{
					if (this._closed)
						break;

					this._closed = true;

					// Remove notification subscriptions.
					this._channel.removeAllListeners(this._internal.consumerId);

					this.emit('@producerclose');
					this.safeEmit('producerclose');

					// Emit observer event.
					this._observer.safeEmit('close');

					break;
				}

				case 'producerpause':
				{
					if (this._producerPaused)
						break;

					const wasPaused = this._paused || this._producerPaused;

					this._producerPaused = true;

					this.safeEmit('producerpause');

					// Emit observer event.
					if (!wasPaused)
						this._observer.safeEmit('pause');

					break;
				}

				case 'producerresume':
				{
					if (!this._producerPaused)
						break;

					const wasPaused = this._paused || this._producerPaused;

					this._producerPaused = false;

					this.safeEmit('producerresume');

					// Emit observer event.
					if (wasPaused && !this._paused)
						this._observer.safeEmit('resume');

					break;
				}

				case 'score':
				{
					const score = data as ConsumerScore;

					this._score = score;

					this.safeEmit('score', score);

					// Emit observer event.
					this._observer.safeEmit('score', score);

					break;
				}

				case 'layerschange':
				{
					const layers = data as ConsumerLayers | undefined;

					this._currentLayers = layers;

					this.safeEmit('layerschange', layers);

					// Emit observer event.
					this._observer.safeEmit('layerschange', layers);

					break;
				}

				case 'trace':
				{
					const trace = data as ConsumerTraceEventData;

					this.safeEmit('trace', trace);

					// Emit observer event.
					this._observer.safeEmit('trace', trace);

					break;
				}

				default:
				{
					logger.error('ignoring unknown event "%s"', event);
				}
			}
		});

		this._payloadChannel.on(
			this._internal.consumerId,
			(event: string, data: any | undefined, payload: Buffer) =>
			{
				switch (event)
				{
					case 'rtp':
					{
						if (this._closed)
							break;

						const packet = payload;

						this.safeEmit('rtp', packet);

						break;
					}

					default:
					{
						logger.error('ignoring unknown event "%s"', event);
					}
				}
			});
	}
}
